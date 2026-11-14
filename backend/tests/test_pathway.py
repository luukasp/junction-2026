import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.ai_routes import Answer, generate_answer, generate_proposal
from app.config import get_settings
from app.db import get_connection
from app.evidence import ChunkIndex, county_evidence, row_year
from app.llm import LLMError, get_provider
from app.main import app
from app.models import review_proposals


def county(code, name):
    return {
        "code": code,
        "name": name,
        "headline": f"{name}: diagnosis stage lags Finland on colonoscopy follow-up.",
        "stage_verdicts": {"screening": "behind", "diagnosis": "on par"},
        "values": {
            "crc_followup": {
                "v": 71.0,
                "lo": 65.0,
                "hi": 77.0,
                "n": 142,
                "d": 200,
                "comparator": {"national": 85.0},
                "verdict": "behind",
            },
            "breast_attend": {
                "v": 82.0,
                "lo": 80.0,
                "hi": 84.0,
                "n": 820,
                "d": 1000,
                "comparator": None,
                "verdict": "on par",
            },
        },
        "actions": [
            {
                "playbook_id": "positive_fit_followup",
                "title": "Close the positive-FIT follow-up gap",
                "pathway_stage": "screening",
                "owner": "County screening and endoscopy leads",
                "baseline": "71% colonoscopy completion",
                "target": "85% within 12 months",
                "annual_volume": 200,
                "timeline": "12 months",
                "first_90_days": "Audit unresolved positive tests and nurse contacts.",
                "concrete_steps": ["Audit open positives", "Book colonoscopy slots"],
                "escalation": "Report to county board quarterly",
                "citations": [{"label": "Colorectal QA manual 10.5", "url": "https://fican.fi/x"}],
            }
        ],
    }


SNAPSHOT = {
    "built": "2026-11-14T10:00:00Z",
    "national_headline": "Finland: follow-up varies twofold between counties.",
    "stages": [
        {"id": "screening", "label": "Screening", "hint": "Invitation to test"},
        {"id": "diagnosis", "label": "Diagnosis", "hint": "Referral to diagnosis"},
    ],
    "indicators": [
        {
            "id": "crc_followup",
            "label": "Colonoscopy after positive FIT",
            "short": "FIT follow-up",
            "stage": "screening",
            "unit": "%",
            "polarity": "higher_better",
            "kind": "rate",
            "period": "2024",
            "source_url": "https://stats.cancerregistry.fi/joukkistilastot/colorectal.html",
            "is_proxy": False,
        },
        {
            "id": "breast_attend",
            "label": "Breast screening attendance",
            "short": "Breast attendance",
            "stage": "diagnosis",
            "unit": "%",
            "polarity": "higher_better",
            "kind": "rate",
            "period": "2024",
            "source_url": "https://stats.cancerregistry.fi/joukkistilastot/breast.html",
            "is_proxy": True,
        },
    ],
    "national": {
        "crc_followup": {"v": 85.0, "lo": 84.0, "hi": 86.0, "n": 8500, "d": 10000},
        "breast_attend": {"v": 82.5, "lo": 82.0, "hi": 83.0, "n": 82500, "d": 100000},
    },
    "verdicts": {"behind": "Significantly worse than Finland"},
    "counties": [county(c, n) for c, n in (("HVA05", "Kymenlaakso"), ("HVA06", "South Karelia"))],
}


@pytest.fixture
def snapshot(tmp_path, monkeypatch):
    path = tmp_path / "pathway_snapshot.json"
    path.write_text(json.dumps(SNAPSHOT))
    monkeypatch.setenv("PATHWAY_SNAPSHOT_PATH", str(path))
    get_settings.cache_clear()
    yield path
    get_settings.cache_clear()


@pytest.fixture
def no_llm_key(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


class UnavailableProvider:
    def generate(self, system, prompt, schema=None):
        raise LLMError("The selected provider's API key is not configured on the backend")


class GroundedProvider:
    """Cites an action, a policy and the pathway row with the new action-plan fields."""

    def generate(self, system, prompt, schema=None):
        ids = [e["id"] for e in json.loads(prompt)["evidence"]]
        cited = [i for i in ids if i.startswith(("action:", "policy:", "pathway:"))][:3]
        return {
            "summary": "Follow-up after positive FIT lags Finland.",
            "findings": [
                {"title": "Follow-up gap", "detail": "71% vs 85%.", "evidence_ids": cited}
            ],
            "proposals": [
                {
                    "title": "Close the follow-up gap",
                    "detail": "Audit open positives.",
                    "evidence_ids": cited,
                    "owner": "Screening lead",
                    "measure": "Completion %",
                    "pathway_stage": "screening",
                    "baseline": "71%",
                    "target": "85%",
                    "timeline": "12 months",
                    "concrete_steps": ["Audit", "Book slots"],
                    "estimated_annual_volume": 200,
                }
            ],
            "limitations": ["Not risk-adjusted."],
        }


@pytest.fixture
def api(engine):
    def connection():
        with engine.connect() as conn:
            yield conn

    app.dependency_overrides[get_connection] = connection
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_pathway_endpoints(api, snapshot):
    data = api.get("/api/v1/pathway").json()
    assert data["built"] == SNAPSHOT["built"]
    assert [c["code"] for c in data["counties"]] == ["HVA05", "HVA06"]
    entry = api.get("/api/v1/pathway/HVA05")
    assert entry.status_code == 200
    assert entry.json()["actions"][0]["playbook_id"] == "positive_fit_followup"
    assert api.get("/api/v1/pathway/HVA99").status_code == 404


def test_pathway_missing_or_invalid_returns_503(api, tmp_path, monkeypatch):
    monkeypatch.setenv("PATHWAY_SNAPSHOT_PATH", str(tmp_path / "absent.json"))
    get_settings.cache_clear()
    try:
        response = api.get("/api/v1/pathway")
        assert response.status_code == 503
        assert "not built" in response.json()["detail"]
        assert api.get("/api/v1/pathway/HVA05").status_code == 503
        bad = tmp_path / "bad.json"
        bad.write_text(json.dumps({"built": "x"}))
        monkeypatch.setenv("PATHWAY_SNAPSHOT_PATH", str(bad))
        get_settings.cache_clear()
        assert api.get("/api/v1/pathway").status_code == 503
    finally:
        get_settings.cache_clear()


def test_evidence_includes_pathway_policy_chunks_and_national(engine, snapshot):
    with engine.connect() as conn:
        context = county_evidence(conn, "HVA05")
    by_id = {e["id"]: e for e in context["evidence"]}
    assert "pathway:HVA05:summary" in by_id
    row = by_id["pathway:HVA05:crc_followup"]["row"]
    assert row["value"] == 71.0 and row["national_value"] == 85.0
    assert row["stage"] == "Screening"
    action = by_id["action:positive_fit_followup"]["row"]
    assert action["target"] == "85% within 12 months"
    assert action["source_url"] == "https://fican.fi/x"
    assert {"policy:screening_reminders", "policy:positive_fit_followup"} <= set(by_id)
    assert by_id["policy:positive_fit_followup"]["row"]["source_url"].startswith("https://")
    chunks = [e for e in context["evidence"] if e["dataset"] == "policy_chunk"]
    assert chunks and all(c["row"]["source_url"] and c["row"]["section"] for c in chunks)
    national = [e for e in context["evidence"] if e["dataset"] == "national"]
    assert any(e["id"].startswith("national:outcomes:") for e in national)
    assert any(e["id"].startswith("national:screening:") for e in national)
    assert all(e["row"]["area_code"] in ("SSS", None) for e in national)
    assert context["quality"]["grounding"]["pathway_snapshot"] is True


def test_ranking_prefers_headline_rows_and_key_series(engine):
    with engine.connect() as conn:
        context = county_evidence(conn, "HVA15")
    screening = [e["row"] for e in context["evidence"] if e["dataset"] == "screening"]
    # Headline percentages from the latest year lead each program.
    for program in ("breast", "cervix", "colorectal"):
        first = next(r for r in screening if r["program"] == program)
        assert first["unit"] == "percent" and first["year"] == 2024
    statfin = [e["row"] for e in context["evidence"] if e["dataset"] == "statfin"]
    assert statfin and all(r["dataset"] != "statfin_11ay" for r in statfin)
    assert {r["metric_code"] for r in statfin} <= {
        "ksyylkm",
        "ksyycdr",
        "vaerak-vaesto",
        "vaesto_yli64_p",
        "vaesto_keski_ika",
        "vaerak-vaesto_maa_pa",
        "vaesto_kieli_sv_p",
        "vaesto_kieli_ulk_p",
        "vaesto_tausta_ulk_p",
        "vaesto_ms_p",
    }
    coverage = {c["dataset"]: c for c in context["quality"]["coverage"]}
    assert coverage["treatments"]["latest_year"] == 2023
    assert coverage["outcomes"]["latest_year"] == 2024


def test_row_year_and_bm25():
    assert row_year({"year": 2020}) == 2020
    assert row_year({"diagnosis_period": "2019-2023"}) == 2023
    assert row_year({"period": "2024"}) == 2024
    assert row_year({}) == 0
    index = ChunkIndex(
        [
            {"chunk_id": "a", "document_id": "d1", "text": "colonoscopy follow-up after FIT"},
            {"chunk_id": "b", "document_id": "d2", "text": "breast mammography invitations"},
        ]
    )
    assert [c["chunk_id"] for _, c in index.search("colonoscopy")] == ["a"]
    assert index.search("") == []


def test_proposal_schema_extension_and_backwards_compatibility(engine, snapshot):
    old = {
        "summary": "s",
        "findings": [],
        "proposals": [
            {"title": "t", "detail": "d", "evidence_ids": ["x"], "owner": "o", "measure": "m"}
        ],
        "limitations": ["l"],
    }
    assert Answer.model_validate(old).proposals[0].pathway_stage is None
    with engine.connect() as conn:
        context = county_evidence(conn, "HVA05")
    answer = generate_answer(GroundedProvider(), context, "Review", require_proposals=True)
    proposal = answer["proposals"][0]
    assert proposal["pathway_stage"] == "screening"
    assert proposal["estimated_annual_volume"] == 200
    assert proposal["evidence_ids"][0].startswith(("action:", "policy:", "pathway:"))


def test_fabricated_action_id_is_rejected(engine, snapshot):
    class Fabricating(GroundedProvider):
        def generate(self, system, prompt, schema=None):
            result = super().generate(system, prompt)
            result["proposals"][0]["evidence_ids"] = ["action:invented_playbook"]
            return result

    with engine.connect() as conn:
        context = county_evidence(conn, "HVA05")
    with pytest.raises(Exception) as error:
        generate_answer(Fabricating(), context, "Review")
    assert getattr(error.value, "status_code", None) == 502


def test_briefing_falls_back_to_snapshot_without_llm(api, engine, snapshot, no_llm_key):
    with engine.connect() as conn:
        before = conn.scalar(select(func.count()).select_from(review_proposals))
    response = api.get("/api/v1/counties/HVA05/proposal")
    assert response.status_code == 200
    proposal = response.json()["proposal"]
    assert proposal["fallback"] is True and proposal["provider"] == "deterministic"
    answer = proposal["answer"]
    assert answer["summary"].startswith("Kymenlaakso")
    ids = {e["id"] for e in proposal["evidence"]}
    first = answer["proposals"][0]
    assert first["evidence_ids"][0] == "action:positive_fit_followup"
    assert set(first["evidence_ids"]) <= ids
    assert first["pathway_stage"] == "screening"
    assert first["target"] == "85% within 12 months"
    assert first["estimated_annual_volume"] == 200
    assert first["concrete_steps"] == ["Audit open positives", "Book colonoscopy slots"]
    assert all(set(f["evidence_ids"]) <= ids for f in answer["findings"])
    Answer.model_validate(answer)
    # POST with an unreachable provider also serves the deterministic briefing, unsaved.
    app.dependency_overrides[get_provider] = UnavailableProvider
    response = api.post("/api/v1/counties/HVA05/proposal")
    assert response.status_code == 200
    assert response.json()["fallback"] is True
    with engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(review_proposals)) == before


def test_no_fallback_without_snapshot_or_when_review_exists(api, engine, snapshot, monkeypatch):
    app.dependency_overrides[get_provider] = UnavailableProvider
    # HVA07 is absent from the fixture snapshot: the provider error is surfaced.
    assert api.post("/api/v1/counties/HVA07/proposal").status_code == 502
    with engine.connect() as conn:
        generate_proposal(conn, "HVA06", GroundedProvider(), force=True)
    # A stored review exists, so regeneration failures are reported, not masked.
    assert api.post("/api/v1/counties/HVA06/proposal?force=true").status_code == 502


def test_chat_and_chat_stream_fallback_when_llm_unconfigured(api, snapshot, no_llm_key):
    app.dependency_overrides[get_provider] = UnavailableProvider
    resp = api.post(
        "/api/v1/counties/HVA05/chat",
        json={"question": "What should we review first, and who owns it?"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "deterministic"
    assert "County screening and endoscopy leads" in body["answer"]["reply"]
    ids = {e["id"] for e in body["evidence"]}
    assert set(body["answer"]["proposals"][0]["evidence_ids"]) <= ids

    stream_resp = api.post(
        "/api/v1/counties/HVA05/chat/stream",
        json={"question": "Which data gaps limit this picture?"},
    )
    assert stream_resp.status_code == 200
    events = [
        json.loads(line[5:])
        for line in stream_resp.text.splitlines()
        if line.startswith("data:")
    ]
    assert any(e["type"] == "delta" for e in events)
    assert events[-1]["type"] == "done"
    assert events[-1]["response"]["provider"] == "deterministic"
    assert "47.7%" in events[-1]["response"]["answer"]["reply"]
