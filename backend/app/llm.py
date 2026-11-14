"""Provider boundary. Never expose provider bodies, URLs containing keys, or credentials."""

import json
from collections.abc import Iterator
from typing import Protocol

import httpx

from app.config import Settings, get_settings


class LLMError(Exception):
    pass


class LLMProvider(Protocol):
    def generate(self, system: str, prompt: str, schema: dict | None = None) -> dict: ...


class HTTPProvider:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _request(self, system: str, prompt: str, schema: dict | None, stream: bool):
        s = self.settings
        if s.llm_provider == "gemini":
            key = s.gemini_api_key.get_secret_value()
            method = "streamGenerateContent?alt=sse" if stream else "generateContent"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{s.llm_model}:{method}"
            headers = {"x-goog-api-key": key}
            body = {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
            }
            if schema:
                body["generationConfig"]["responseJsonSchema"] = schema
        elif s.llm_provider == "openai-compatible":
            key = s.llm_api_key.get_secret_value()
            url = s.llm_base_url.rstrip("/") + "/chat/completions"
            headers = {"Authorization": f"Bearer {key}"}
            body = {
                "model": s.llm_model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "response_format": {"type": "json_object"},
            }
            if stream:
                body["stream"] = True
        else:
            raise LLMError("Unsupported LLM_PROVIDER; use gemini or openai-compatible")
        if not key:
            raise LLMError("The selected provider's API key is not configured on the backend")
        return url, headers, body

    @staticmethod
    def _check(response):
        if response.status_code == 429:
            raise LLMError("AI provider rate limit reached; retry later")
        if not response.is_success:
            raise LLMError(f"AI provider request failed (HTTP {response.status_code})")

    def generate(self, system: str, prompt: str, schema: dict | None = None) -> dict:
        s = self.settings
        url, headers, body = self._request(system, prompt, schema, stream=False)
        try:
            with httpx.Client(timeout=s.llm_timeout_seconds) as client:
                response = client.post(url, headers=headers, json=body)
            self._check(response)
            data = response.json()
            if s.llm_provider == "gemini":
                candidate = data["candidates"][0]
                if candidate.get("finishReason") != "STOP":
                    raise LLMError("AI response was blocked or incomplete; retry generation")
                content = "".join(
                    p.get("text", "") for p in candidate["content"]["parts"] if not p.get("thought")
                )
            else:
                choice = data["choices"][0]
                if choice.get("finish_reason") != "stop":
                    raise LLMError("AI response was incomplete; retry generation")
                content = choice["message"]["content"]
            return json.loads(content)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
            raise LLMError("AI provider returned an unavailable or invalid response") from None

    def stream(self, system: str, prompt: str, schema: dict | None = None) -> Iterator[str]:
        """Yield raw JSON text chunks as the provider produces them."""
        s = self.settings
        url, headers, body = self._request(system, prompt, schema, stream=True)
        finish = None
        try:
            with httpx.Client(timeout=s.llm_timeout_seconds) as client:
                with client.stream("POST", url, headers=headers, json=body) as response:
                    self._check(response)
                    for line in response.iter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        event = json.loads(data)
                        if s.llm_provider == "gemini":
                            candidate = (event.get("candidates") or [{}])[0]
                            finish = candidate.get("finishReason") or finish
                            parts = (candidate.get("content") or {}).get("parts") or []
                            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
                        else:
                            choice = (event.get("choices") or [{}])[0]
                            finish = choice.get("finish_reason") or finish
                            text = (choice.get("delta") or {}).get("content") or ""
                        if text:
                            yield text
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
            raise LLMError("AI provider returned an unavailable or invalid response") from None
        if finish not in ("STOP", "stop"):
            raise LLMError("AI response was blocked or incomplete; retry generation")


def stream_text(provider, system: str, prompt: str, schema: dict | None = None) -> Iterator[str]:
    """Stream from providers that support it; otherwise yield the whole response once."""
    if hasattr(provider, "stream"):
        yield from provider.stream(system, prompt, schema=schema)
    else:
        yield json.dumps(provider.generate(system, prompt, schema=schema))


def get_provider() -> LLMProvider:
    return HTTPProvider(get_settings())
