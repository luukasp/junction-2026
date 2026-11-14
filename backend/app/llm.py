"""Provider boundary. Never expose provider bodies, URLs containing keys, or credentials."""

import json
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

    def generate(self, system: str, prompt: str, schema: dict | None = None) -> dict:
        s = self.settings
        if s.llm_provider == "gemini":
            key = s.gemini_api_key.get_secret_value()
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{s.llm_model}:generateContent"
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
        else:
            raise LLMError("Unsupported LLM_PROVIDER; use gemini or openai-compatible")
        if not key:
            raise LLMError("The selected provider's API key is not configured on the backend")
        try:
            with httpx.Client(timeout=s.llm_timeout_seconds) as client:
                response = client.post(url, headers=headers, json=body)
            if response.status_code == 429:
                raise LLMError("AI provider rate limit reached; retry later")
            if not response.is_success:
                raise LLMError(f"AI provider request failed (HTTP {response.status_code})")
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


def get_provider() -> LLMProvider:
    return HTTPProvider(get_settings())
