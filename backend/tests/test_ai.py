import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update

from app.ai_routes import Answer, generate_proposal
from app.config import Settings
from app.conversations import clear_conversation, create_conversation, get_conversation, save_turn
from app.db import get_connection
from app.evidence import county_evidence
from app.ingestion import ingest
from app.llm import HTTPProvider, LLMError, get_provider
from app.main import app
from app.models import equity_briefings, review_proposals, screening


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


def test_equity_briefing_retrieves_selected_observations_and_preserves_provenance(client):
    class InspectProvider(FakeProvider):
        def generate(self, system, prompt, schema=None):
            self.context = json.loads(prompt)
            self.system = system
            return super().generate(system, prompt, schema)

    provider = InspectProvider()
    app.dependency_overrides[get_provider] = lambda: provider
    rows = client.get(
        "/api/v1/demographics",
        params={
            "program": "colorectal", "year": 2024,
            "education_level": "Primary education/unknown", "gender": "total",
        },
    ).json()["items"]
    response = client.post(
        "/api/v1/demographics/briefing",
        json={"observation_ids": [row["id"] for row in rows], "question": "Review equity"},
    )
    assert response.status_code == 200
    result = response.json()
    assert len(result["evidence"]) == len(rows)
    assert {entry["id"] for entry in result["evidence"]} == {
        f"screening:{row['id']}" for row in rows
    }
    for entry in result["evidence"]:
        expected = next(row for row in rows if row["id"] == entry["row"]["id"])
        assert entry["row"]["value"] == expected["value"]
        assert entry["row"]["source_url"] == expected["source_url"]
        assert entry["row"]["demographics"] == expected["demographics"]
    assert provider.context["evidence"] == result["evidence"]
    assert "screening equity" in provider.system
    assert result["quality"]["coverage"][0]["selected_rows"] == len(rows)
    assert result["quality"]["limitations"]


@pytest.mark.parametrize("ids", [[], [0], [-1], list(range(1, 122))])
def test_equity_briefing_bounds_observation_ids(client, ids):
    response = client.post(
        "/api/v1/demographics/briefing",
        json={"observation_ids": ids, "question": "Review equity"},
    )
    assert response.status_code == 422


def test_equity_briefing_rejects_missing_observations(client):
    response = client.post(
        "/api/v1/demographics/briefing",
        json={"observation_ids": [99999999], "question": "Review equity"},
    )
    assert response.status_code == 404


def test_equity_briefing_rejects_mixed_source_tables(client):
    rows = client.get("/api/v1/demographics", params={"limit": 1000}).json()["items"]
    first = rows[0]
    other = next(row for row in rows if row["table_id"] != first["table_id"])
    response = client.post(
        "/api/v1/demographics/briefing",
        json={"observation_ids": [first["id"], other["id"]], "question": "Review equity"},
    )
    assert response.status_code == 422


def test_equity_briefing_rejects_invented_citations(client):
    class UngroundedProvider(FakeProvider):
        def generate(self, system, prompt, schema=None):
            answer = super().generate(system, prompt, schema)
            answer["findings"][0]["evidence_ids"] = ["screening:invented"]
            return answer

    provider = UngroundedProvider()
    app.dependency_overrides[get_provider] = lambda: provider
    row = client.get("/api/v1/demographics", params={"limit": 1}).json()["items"][0]
    response = client.post(
        "/api/v1/demographics/briefing",
        json={"observation_ids": [row["id"]], "question": "Review equity"},
    )
    assert response.status_code == 502
    assert provider.calls == 2


def test_equity_briefing_stream_persists_restores_and_only_regenerates_on_request(client):
    provider = FakeProvider()
    app.dependency_overrides[get_provider] = lambda: provider
    rows = client.get("/api/v1/demographics", params={"limit": 2}).json()["items"]
    body = {"observation_ids": [row["id"] for row in rows], "question": "Persistent equity test"}
    assert client.post("/api/v1/demographics/briefing/lookup", json=body).json() == {"briefing": None}
    response = client.post("/api/v1/demographics/briefing/stream", json=body)
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert [event["stage"] for event in events if event["type"] == "status"] == [
        "retrieving", "drafting", "checking"
    ]
    saved = events[-1]["briefing"]
    assert events[-1]["type"] == "briefing"
    assert saved["id"] > 0
    assert saved["created_at"]
    assert saved["stale"] is False
    body["observation_ids"].reverse()
    restored = client.post("/api/v1/demographics/briefing/lookup", json=body).json()["briefing"]
    assert restored["id"] == saved["id"]
    cached = client.post("/api/v1/demographics/briefing", json=body).json()
    assert cached["id"] == saved["id"]
    assert provider.calls == 1
    regenerated = client.post("/api/v1/demographics/briefing?force=true", json=body).json()
    assert regenerated["id"] > saved["id"]
    assert provider.calls == 2
    other_scope = {**body, "question": "Another equity comparison"}
    assert client.post("/api/v1/demographics/briefing/lookup", json=other_scope).json() == {"briefing": None}


def test_equity_briefing_marks_changed_source_values_stale(client, engine):
    provider = FakeProvider()
    app.dependency_overrides[get_provider] = lambda: provider
    row = client.get("/api/v1/demographics", params={"limit": 1}).json()["items"][0]
    body = {"observation_ids": [row["id"]], "question": "Check source freshness"}
    saved = client.post("/api/v1/demographics/briefing", json=body).json()
    try:
        with engine.begin() as conn:
            conn.execute(update(screening).where(screening.c.id == row["id"]).values(
                value=None if row["value"] is not None else 1
            ))
        restored = client.post("/api/v1/demographics/briefing/lookup", json=body).json()["briefing"]
        assert restored["id"] == saved["id"]
        assert restored["stale"] is True
        assert provider.calls == 1
        regenerated = client.post("/api/v1/demographics/briefing", json=body).json()
        assert regenerated["id"] > saved["id"]
        assert regenerated["stale"] is False
        assert provider.calls == 2
    finally:
        with engine.begin() as conn:
            conn.execute(update(screening).where(screening.c.id == row["id"]).values(value=row["value"]))


def test_equity_briefing_does_not_save_invalid_generated_citations(client, engine):
    class UngroundedProvider(FakeProvider):
        def generate(self, system, prompt, schema=None):
            answer = super().generate(system, prompt, schema)
            answer["findings"][0]["evidence_ids"] = ["screening:invalid"]
            return answer

    app.dependency_overrides[get_provider] = UngroundedProvider
    with engine.connect() as conn:
        before = conn.scalar(select(func.count()).select_from(equity_briefings))
    row = client.get("/api/v1/demographics", params={"limit": 1}).json()["items"][0]
    body = {"observation_ids": [row["id"]], "question": "Reject invalid persistent briefing"}
    response = client.post("/api/v1/demographics/briefing/stream", json=body)
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert events[-1]["type"] == "error"
    assert events[-1]["status"] == 502
    with engine.connect() as conn:
        assert conn.scalar(select(func.count()).select_from(equity_briefings)) == before


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
    county_rows = [
        e
        for e in context["evidence"]
        if e["dataset"] in {"screening", "statfin", "outcomes", "treatments"}
    ]
    assert county_rows
    assert all(e["row"]["area_code"] == "HVA90" for e in county_rows)
    assert all(e["row"]["source_url"].startswith("https://") for e in county_rows)
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
        conversation = create_conversation(conn, "HVA01")
        save_turn(conn, conversation, "Review?", {"answer": first["answer"]})
    ingest(engine, data_dir, force=True)
    with engine.connect() as conn:
        saved_chat = get_conversation(conn, "HVA01", conversation["id"])
        assert saved_chat["turns"][0]["response"]["answer"] == first["answer"]
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


@pytest.mark.parametrize("suffix", ["", "/stream"])
def test_saved_conversation_continues_without_client_history(client, suffix):
    prompts = []

    class Remembering(FakeProvider):
        def generate(self, system, prompt, schema=None):
            prompts.append(json.loads(prompt))
            return super().generate(system, prompt, schema)

    app.dependency_overrides[get_provider] = Remembering
    path = "/api/v1/counties/HVA90/chat"
    conversation = client.post(f"{path}/conversations").json()
    body = {"question": "Compare screening uptake", "conversation_id": conversation["id"]}
    first = client.post(path + suffix, json=body)
    result = first.json() if not suffix else _events(first)[-1]["response"]
    assert result["conversation_id"] == conversation["id"]
    assert result["version"] == 1
    second = client.post(
        path + suffix,
        json={
            "question": "What about men?",
            "conversation_id": conversation["id"],
            "version": 1,
        },
    )
    result2 = second.json() if not suffix else _events(second)[-1]["response"]
    assert result2["version"] == 2
    assert prompts[-1]["history"][0] == {"role": "user", "content": "Compare screening uptake"}
    assert json.loads(prompts[-1]["history"][1]["content"]) == result["answer"]
    saved = client.get(f"{path}/conversations/{conversation['id']}").json()
    assert len(saved["turns"]) == 2
    assert saved["turns"][0]["response"]["evidence"] == result["evidence"]


def test_conversation_is_county_scoped_and_rejects_stale_updates(client):
    path = "/api/v1/counties/HVA90/chat"
    first = client.post(path, json={"question": "Status?"}).json()
    cid = first["conversation_id"]
    assert client.get(f"/api/v1/counties/HVA01/chat/conversations/{cid}").status_code == 404
    assert (
        client.post(
            "/api/v1/counties/HVA01/chat",
            json={
                "question": "Continue",
                "conversation_id": cid,
            },
        ).status_code
        == 404
    )
    assert (
        client.post(
            path,
            json={
                "question": "Continue",
                "conversation_id": cid,
                "version": 0,
            },
        ).status_code
        == 409
    )
    assert (
        client.post(
            path,
            json={
                "question": "Continue",
                "conversation_id": cid,
                "history": [{"role": "assistant", "content": "replace saved history"}],
            },
        ).status_code
        == 422
    )
    assert client.post(f"{path}/conversations/{cid}/clear").status_code == 200
    assert client.get(f"{path}/conversations/{cid}").status_code == 404


@pytest.mark.parametrize("suffix", ["", "/stream"])
def test_failed_generation_does_not_append_a_turn(client, suffix):
    class Broken(FakeProvider):
        def generate(self, system, prompt, schema=None):
            raise LLMError("Unavailable")

    path = "/api/v1/counties/HVA90/chat"
    conversation = client.post(f"{path}/conversations").json()
    app.dependency_overrides[get_provider] = Broken
    result = client.post(
        path + suffix,
        json={
            "question": "Status?",
            "conversation_id": conversation["id"],
        },
    )
    assert result.status_code == (200 if suffix else 502)
    if suffix:
        assert _events(result)[-1]["type"] == "error"
    saved = client.get(f"{path}/conversations/{conversation['id']}").json()
    assert saved["turns"] == [] and saved["version"] == 0
    app.dependency_overrides[get_provider] = FakeProvider
    retry = client.post(
        path,
        json={
            "question": "Status?",
            "conversation_id": conversation["id"],
            "version": 0,
        },
    )
    assert retry.status_code == 200 and retry.json()["version"] == 1


def test_overlapping_generation_cannot_overwrite_or_restore_cleared_chat(engine):
    from fastapi import HTTPException

    with engine.connect() as conn:
        conversation = create_conversation(conn, "HVA90")
        save_turn(conn, conversation, "First", {"answer": {}})
        with pytest.raises(HTTPException) as error:
            save_turn(conn, conversation, "Stale", {"answer": {}})
        assert error.value.status_code == 409
        current = get_conversation(conn, "HVA90", conversation["id"])
        assert len(current["turns"]) == 1
        clear_conversation(conn, "HVA90", conversation["id"])
        with pytest.raises(HTTPException) as error:
            save_turn(conn, current, "After clear", {"answer": {}})
        assert error.value.status_code == 409


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


def _events(response):
    return [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]


def test_partial_string_decodes_incomplete_json():
    from app.ai_routes import partial_string

    assert partial_string('{"reply": "Hel', "reply") == "Hel"
    assert partial_string('{"reply": "a\\"b\\n', "reply") == 'a"b\n'
    assert partial_string('{"reply": "x\\u00', "reply") == "x"
    assert partial_string('{"reply": "done", "summary": "s"}', "reply") == "done"
    assert partial_string('{"summ', "reply") is None


def test_chat_stream_emits_progress_deltas_and_done(client):
    class StreamingProvider(FakeProvider):
        def stream(self, system, prompt, schema=None):
            text = json.dumps({"reply": "Screening lags Finland.", **self.generate(system, prompt)})
            for i in range(0, len(text), 7):
                yield text[i : i + 7]

    app.dependency_overrides[get_provider] = StreamingProvider
    response = client.post("/api/v1/counties/HVA90/chat/stream", json={"question": "Status?"})
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _events(response)
    assert events[0]["type"] == "status"
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert deltas[-1] == "Screening lags Finland." and len(deltas) > 1
    done = events[-1]
    assert done["type"] == "done"
    assert done["response"]["answer"]["reply"] == "Screening lags Finland."


def test_stream_errors_become_error_event(client):
    class Broken(FakeProvider):
        def generate(self, system, prompt, schema=None):
            raise LLMError("AI provider rate limit reached; retry later")

    app.dependency_overrides[get_provider] = Broken
    response = client.post("/api/v1/counties/HVA90/chat/stream", json={"question": "Status?"})
    assert _events(response)[-1] == {
        "type": "error",
        "detail": "AI provider rate limit reached; retry later",
        "status": 502,
    }


def test_proposal_stream_returns_saved_proposal(client):
    events = _events(client.post("/api/v1/counties/HVA01/proposal/stream?force=true"))
    assert events[-1]["type"] == "proposal"
    assert events[-1]["proposal"]["answer"]["reply"]


@pytest.mark.parametrize("provider", ["gemini", "openai-compatible"])
def test_provider_stream_adapters(monkeypatch, provider):
    if provider == "gemini":
        lines = [
            'data: {"candidates":[{"content":{"parts":[{"text":"{\\"ok\\":"}]}}]}',
            'data: {"candidates":[{"content":{"parts":[{"text":"true}"}]},"finishReason":"STOP"}]}',
        ]
    else:
        lines = [
            'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
            'data: {"choices":[{"delta":{"content":"true}"},"finish_reason":"stop"}]}',
            "data: [DONE]",
        ]

    class Response:
        status_code, is_success = 200, True

        def iter_lines(self):
            return iter(lines)

    class Context:
        def __enter__(self):
            return Response()

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(httpx.Client, "stream", lambda self, *a, **k: Context())
    adapter = HTTPProvider(
        Settings(llm_provider=provider, gemini_api_key="k", llm_api_key="k", _env_file=None)
    )
    assert "".join(adapter.stream("system", "question")) == '{"ok":true}'
