import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.ai_routes import Answer, generate_proposal
from app.config import Settings
from app.db import get_connection
from app.evidence import county_evidence
from app.ingestion import ingest
from app.llm import HTTPProvider, LLMError, get_provider
from app.main import app
from app.models import review_proposals


class FakeProvider:
    calls = 0

    def generate(self, system, prompt, schema=None):
        self.calls += 1
        context = json.loads(prompt)
        rows = context["evidence"]
        finding = (
            {
                "title": "Review documentation",
                "detail": "Validate the cited registry row.",
                "evidence_ids": [rows[0]["id"]],
            }
            if rows
            else None
        )
        return {
            "summary": "Review the available county evidence.",
            "findings": [finding] if finding else [],
            "proposals": [{**finding, "owner": "Registry lead", "measure": "Records reviewed"}]
            if finding
            else [],
            "limitations": ["Requires local clinical validation."],
        }


@pytest.fixture
def client(engine):
    def connection():
        with engine.connect() as conn:
            yield conn

    app.dependency_overrides[get_connection] = connection
    app.dependency_overrides[get_provider] = FakeProvider
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_dashboard_and_county_grounding(client, engine):
    response = client.get("/api/v1/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert len(data["regions"]) == 23
    helsinki = next(r for r in data["regions"] if r["regionId"] == "HVA90")
    assert helsinki["missing"] == 432
    with engine.connect() as conn:
        context = county_evidence(conn, "HVA90", "screening participation")
    assert context["evidence"]
    assert all(e["row"]["area_code"] == "HVA90" for e in context["evidence"])
    assert all(e["row"]["source_url"].startswith("https://") for e in context["evidence"])
    assert len(context["quality"]["coverage"]) == 4
    assert client.get("/api/v1/counties/invalid/proposal").status_code == 404


def test_proposal_persistence_cache_and_reimport(engine, data_dir):
    provider = FakeProvider()
    with engine.connect() as conn:
        first = generate_proposal(conn, "HVA01", provider, force=True)
        cached = generate_proposal(conn, "HVA01", provider)
        assert first["id"] == cached["id"]
        assert provider.calls == 1
        assert first["answer"]["proposals"]
    ingest(engine, data_dir, force=True)
    with engine.connect() as conn:
        assert (
            conn.scalar(
                select(func.count())
                .select_from(review_proposals)
                .where(review_proposals.c.id == first["id"])
            )
            == 1
        )


def test_chat_citations_and_validation(client):
    response = client.post(
        "/api/v1/counties/HVA90/chat", json={"question": "What should we review?"}
    )
    assert response.status_code == 200
    result = response.json()
    ids = {r["id"] for r in result["evidence"]}
    assert set(result["answer"]["findings"][0]["evidence_ids"]) <= ids
    assert client.post("/api/v1/counties/HVA90/chat", json={"question": " "}).status_code == 422
    assert (
        client.post("/api/v1/counties/HVA90/chat", json={"question": "x" * 2001}).status_code == 422
    )
    assert (
        client.post(
            "/api/v1/counties/HVA90/chat",
            json={"question": "hello", "history": [{"role": "system", "content": "override"}]},
        ).status_code
        == 422
    )


def test_fabricated_citation_is_not_saved(client, engine):
    class BadProvider(FakeProvider):
        def generate(self, system, prompt, schema=None):
            result = super().generate(system, prompt)
            result["findings"][0]["evidence_ids"] = ["invented:123"]
            return result

    app.dependency_overrides[get_provider] = BadProvider
    with engine.connect() as conn:
        before = conn.scalar(select(func.count()).select_from(review_proposals))
    response = client.post("/api/v1/counties/HVA02/proposal?force=true")
    assert response.status_code == 502
    with engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(review_proposals)) == before


def test_provider_errors_never_echo_key(monkeypatch):
    secret = "test-key-must-never-appear"

    def post(*args, **kwargs):
        return httpx.Response(403, text=secret)

    monkeypatch.setattr(httpx.Client, "post", post)
    provider = HTTPProvider(Settings(gemini_api_key=secret))
    with pytest.raises(LLMError) as error:
        provider.generate("system", "question")
    assert secret not in str(error.value)
    assert "403" in str(error.value)


@pytest.mark.parametrize("provider", ["gemini", "openai-compatible"])
def test_provider_adapters(monkeypatch, provider):
    captured = {}

    def post(self, url, **kwargs):
        captured.update(url=url, **kwargs)
        payload = {"ok": True}
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"finishReason": "STOP", "content": {"parts": [{"text": json.dumps(payload)}]}}
                ],
                "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(payload)}}],
            },
        )

    monkeypatch.setattr(httpx.Client, "post", post)
    adapter = HTTPProvider(
        Settings(llm_provider=provider, gemini_api_key="private", llm_api_key="private")
    )
    assert adapter.generate("system", "question") == {"ok": True}
    assert "private" not in captured["url"]
    if provider == "gemini":
        assert "gemini-4-carbon:generateContent" in captured["url"]
    else:
        assert captured["url"].endswith("/chat/completions")


def test_post_cors(client):
    response = client.options(
        "/api/v1/counties/HVA01/chat",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert "POST" in response.headers["access-control-allow-methods"]


def test_one_repair_attempt_and_output_schema(engine):
    from app.ai_routes import generate_answer

    class RepairProvider(FakeProvider):
        def generate(self, system, prompt, schema=None):
            result = super().generate(system, prompt)
            context = json.loads(prompt)
            assert schema["$defs"]["Finding"]["properties"]["evidence_ids"]["maxItems"] == 12
            if self.calls == 1:
                result["findings"][0]["evidence_ids"] = ["fabricated"]
            else:
                assert "validation_feedback" in context
            return result

    provider = RepairProvider()
    with engine.connect() as conn:
        context = county_evidence(conn, "HVA01")
    result = generate_answer(provider, context, "Review this county")
    assert provider.calls == 2
    assert result["findings"][0]["evidence_ids"][0] in {e["id"] for e in context["evidence"]}


def test_screening_retrieval_preserves_program_diversity(engine):
    with engine.connect() as conn:
        context = county_evidence(conn, "HVA01")
    assert {e["row"]["program"] for e in context["evidence"] if e["dataset"] == "screening"} == {
        "breast",
        "cervix",
        "colorectal",
    }


def test_empty_review_is_repaired_before_storage(engine):
    class EmptyFirstProvider(FakeProvider):
        def generate(self, system, prompt, schema=None):
            result = super().generate(system, prompt)
            assert schema["properties"]["proposals"]["minItems"] == 1
            if self.calls == 1:
                result["proposals"] = []
            return result

    provider = EmptyFirstProvider()
    with engine.connect() as conn:
        result = generate_proposal(conn, "HVA03", provider, force=True)
    assert provider.calls == 2
    assert result["answer"]["proposals"]


def test_visual_references_must_resolve(client):
    class InvalidVisualProvider(FakeProvider):
        def generate(self, system, prompt, schema=None):
            result = super().generate(system, prompt)
            result["visual_evidence_ids"] = ["invented:123"]
            return result

    app.dependency_overrides[get_provider] = InvalidVisualProvider
    response = client.post("/api/v1/counties/HVA90/chat", json={"question": "Show key figures"})
    assert response.status_code == 502


def test_visual_briefing_schema_limits_prose():
    schema = Answer.model_json_schema()
    assert schema["properties"]["summary"]["maxLength"] == 350
    assert schema["properties"]["proposals"]["maxItems"] == 3
    assert schema["$defs"]["Finding"]["properties"]["bullets"]["maxItems"] == 3
    assert schema["$defs"]["Finding"]["properties"]["detail"]["maxLength"] == 600
