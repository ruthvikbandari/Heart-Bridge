import asyncio
import base64
import json
from types import SimpleNamespace

import httpx
import pytest

from app.services import ai_provider
from app.services.ai_prompts import SYSTEM_PROMPT, intent_note


def test_direct_questions_take_priority_over_listen_intent():
    note = intent_note("listen")

    assert "answer that request first" in note
    assert "never overrides their explicit request" in note
    assert "specific, practical steps" in SYSTEM_PROMPT
    assert "avoid vague advice" in SYSTEM_PROMPT


def test_gemini_stream_sends_chat_history_server_side(monkeypatch):
    settings = SimpleNamespace(
        gemini_api_key="test-gemini-key",
        gemini_model="gemini-3.6-flash",
        ai_max_tokens=700,
        ai_timeout_seconds=10,
    )
    monkeypatch.setattr(ai_provider, "get_settings", lambda: settings)
    requests = []
    client_class = httpx.AsyncClient

    def handle_request(request):
        requests.append(request)
        events = [
            {"candidates": [{"content": {"parts": [{"text": "Python is"}]}}]},
            {"candidates": [{"content": {"parts": [{"text": " a programming language."}]}}]},
        ]
        body = "\n\n".join(f"data: {json.dumps(event)}" for event in events) + "\n\n"
        return httpx.Response(200, text=body)

    monkeypatch.setattr(
        ai_provider.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handle_request), **kwargs),
    )

    req = ai_provider.GenerationRequest(
        history=[
            {"role": "user", "content": "What is Python?"},
            {"role": "assistant", "content": "What would you like to know?"},
        ],
        style="straightforward",
        intent="info",
        profile_note="Do not use profile details.",
    )
    provider = ai_provider.GeminiProvider()

    async def collect():
        return [token async for token in provider.stream(req)]

    assert "".join(asyncio.run(collect())) == "Python is a programming language."
    request = requests[0]
    assert request.url.host == "generativelanguage.googleapis.com"
    assert request.headers["x-goog-api-key"] == "test-gemini-key"
    assert "test-gemini-key" not in str(request.url)
    payload = json.loads(request.content)
    assert payload["contents"] == [
        {"role": "user", "parts": [{"text": "What is Python?"}]},
        {"role": "model", "parts": [{"text": "What would you like to know?"}]},
    ]
    assert payload["generationConfig"]["maxOutputTokens"] == 700


def test_gemini_stream_attaches_image_to_latest_user_turn(monkeypatch):
    settings = SimpleNamespace(
        gemini_api_key="test-gemini-key",
        gemini_model="gemini-3.6-flash",
        ai_max_tokens=700,
        ai_timeout_seconds=10,
    )
    monkeypatch.setattr(ai_provider, "get_settings", lambda: settings)
    requests = []
    client_class = httpx.AsyncClient

    def handle_request(request):
        requests.append(request)
        event = {"candidates": [{"content": {"parts": [{"text": "A red apple."}]}}]}
        return httpx.Response(200, text=f"data: {json.dumps(event)}\n\n")

    monkeypatch.setattr(
        ai_provider.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handle_request), **kwargs),
    )
    encoded = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode("ascii")
    req = ai_provider.GenerationRequest(
        history=[{"role": "user", "content": "Describe this image."}],
        style="straightforward",
        intent="info",
        profile_note="Do not use profile details.",
        attachment=ai_provider.GenerationAttachment(mime_type="image/png", data=encoded),
    )

    async def collect():
        return [token async for token in ai_provider.GeminiProvider().stream(req)]

    assert "".join(asyncio.run(collect())) == "A red apple."
    payload = json.loads(requests[0].content)
    assert payload["contents"][-1]["parts"] == [
        {"text": "Describe this image."},
        {"inline_data": {"mime_type": "image/png", "data": encoded}},
    ]


def test_gemini_is_selected_before_existing_openai_provider(monkeypatch):
    monkeypatch.setattr(
        ai_provider,
        "get_settings",
        lambda: SimpleNamespace(gemini_api_key="test-gemini-key", openai_api_key="test-openai-key"),
    )

    assert isinstance(ai_provider.get_provider(), ai_provider.GeminiProvider)


def test_gemini_retries_temporary_provider_overload(monkeypatch):
    settings = SimpleNamespace(
        gemini_api_key="test-gemini-key",
        gemini_model="gemini-3.6-flash",
        ai_max_tokens=700,
        ai_timeout_seconds=10,
    )
    monkeypatch.setattr(ai_provider, "get_settings", lambda: settings)
    attempts = 0
    client_class = httpx.AsyncClient

    def handle_request(request):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(503, json={"error": {"message": "Temporarily unavailable"}})
        event = {"candidates": [{"content": {"parts": [{"text": "Recovered reply."}]}}]}
        return httpx.Response(200, text=f"data: {json.dumps(event)}\n\n")

    monkeypatch.setattr(
        ai_provider.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handle_request), **kwargs),
    )
    request = ai_provider.GenerationRequest(
        history=[{"role": "user", "content": "Hello"}],
        style="straightforward",
        intent="info",
        profile_note="Do not use profile details.",
    )

    async def collect():
        return [token async for token in ai_provider.GeminiProvider().stream(request)]

    assert "".join(asyncio.run(collect())) == "Recovered reply."
    assert attempts == 2


def test_existing_chat_endpoint_streams_gemini_reply(client, monkeypatch):
    settings = SimpleNamespace(
        gemini_api_key="test-gemini-key",
        gemini_model="gemini-3.6-flash",
        ai_max_tokens=1200,
        ai_timeout_seconds=10,
        ai_stream_delay=0,
    )
    monkeypatch.setattr(ai_provider, "get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.ai.get_provider", ai_provider.GeminiProvider)
    client_class = httpx.AsyncClient

    def handle_request(request):
        assert request.headers["x-goog-api-key"] == "test-gemini-key"
        payload = json.loads(request.content)
        assert payload["contents"][-1]["parts"][0]["text"] == "How can I reduce stress?"
        assert payload["generationConfig"]["maxOutputTokens"] == 1200
        instruction = payload["systemInstruction"]["parts"][0]["text"]
        assert "listen mode must still answer direct questions" in instruction
        event = {"candidates": [{"content": {"parts": [{"text": "Try these practical stress-management steps."}]}}]}
        return httpx.Response(200, text=f"data: {json.dumps(event)}\n\n")

    monkeypatch.setattr(
        ai_provider.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handle_request), **kwargs),
    )

    assert client.post(
        "/api/auth/register",
        json={"email": "gemini@example.com", "password": "Password1", "display_name": "Ari"},
    ).status_code == 200
    conversation = client.post("/api/ai/conversations", json={}).json()
    response = client.post(
        f"/api/ai/conversations/{conversation['id']}/messages",
        json={"content": "How can I reduce stress?"},
    )

    assert response.status_code == 200
    assert "Try these practical stress-management steps." in response.text
    assert '"done": true' in response.text
    assert "test-gemini-key" not in response.text


def test_image_chat_streams_with_image_without_persisting_base64(client, monkeypatch):
    settings = SimpleNamespace(
        gemini_api_key="test-gemini-key",
        gemini_model="gemini-3.6-flash",
        ai_provider_name="gemini",
        ai_max_tokens=700,
        ai_timeout_seconds=10,
        ai_stream_delay=0,
    )
    monkeypatch.setattr(ai_provider, "get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.ai.get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.ai.get_provider", ai_provider.GeminiProvider)
    client_class = httpx.AsyncClient
    encoded = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode("ascii")

    def handle_request(request):
        payload = json.loads(request.content)
        assert payload["contents"][-1]["parts"][-1] == {
            "inline_data": {"mime_type": "image/png", "data": encoded}
        }
        event = {"candidates": [{"content": {"parts": [{"text": "It shows an image."}]}}]}
        return httpx.Response(200, text=f"data: {json.dumps(event)}\n\n")

    monkeypatch.setattr(
        ai_provider.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handle_request), **kwargs),
    )
    assert client.post(
        "/api/auth/register",
        json={"email": "image@example.com", "password": "Password1", "display_name": "Ari"},
    ).status_code == 200
    conversation = client.post("/api/ai/conversations", json={}).json()

    response = client.post(
        f"/api/ai/conversations/{conversation['id']}/messages",
        json={"content": "What is in this picture?", "image_mime_type": "image/png", "image_data": encoded},
    )
    assert response.status_code == 200, response.text
    saved = client.get(f"/api/ai/conversations/{conversation['id']}").json()
    assert "It shows an image." in response.text
    assert "[Image attached]\nWhat is in this picture?" == saved["messages"][0]["content"]
    assert encoded not in json.dumps(saved)


def test_chat_image_rejects_invalid_signature():
    from app.routers.ai import ChatIn, decode_chat_attachment
    from fastapi import HTTPException

    body = ChatIn(content="Describe this", image_mime_type="image/png", image_data=base64.b64encode(b"not png").decode())
    with pytest.raises(HTTPException, match="file type does not match"):
        decode_chat_attachment(body)


def test_text_document_is_sent_to_gemini_and_not_saved(client, monkeypatch):
    settings = SimpleNamespace(
        gemini_api_key="test-gemini-key",
        gemini_model="gemini-3.6-flash",
        ai_provider_name="gemini",
        ai_max_tokens=700,
        ai_timeout_seconds=10,
        ai_stream_delay=0,
    )
    monkeypatch.setattr(ai_provider, "get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.ai.get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.ai.get_provider", ai_provider.GeminiProvider)
    client_class = httpx.AsyncClient
    file_text = "Quarterly report: revenue increased by 12%."

    def handle_request(request):
        payload = json.loads(request.content)
        parts = payload["contents"][-1]["parts"]
        assert parts[0]["text"] == "Summarize this file."
        assert "Attached document content" in parts[1]["text"]
        assert file_text in parts[1]["text"]
        event = {"candidates": [{"content": {"parts": [{"text": "Revenue grew by 12%."}]}}]}
        return httpx.Response(200, text=f"data: {json.dumps(event)}\n\n")

    monkeypatch.setattr(
        ai_provider.httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handle_request), **kwargs),
    )
    assert client.post(
        "/api/auth/register",
        json={"email": "document@example.com", "password": "Password1", "display_name": "Ari"},
    ).status_code == 200
    conversation = client.post("/api/ai/conversations", json={}).json()
    encoded = base64.b64encode(file_text.encode()).decode()

    response = client.post(
        f"/api/ai/conversations/{conversation['id']}/messages",
        json={"content": "Summarize this file.", "document_mime_type": "text/plain", "document_data": encoded},
    )
    assert response.status_code == 200, response.text
    saved = client.get(f"/api/ai/conversations/{conversation['id']}").json()
    assert saved["messages"][0]["content"] == "[Document attached]\nSummarize this file."
    assert encoded not in json.dumps(saved)
    assert file_text not in json.dumps(saved)


def test_chat_pdf_rejects_invalid_signature():
    from app.routers.ai import ChatIn, decode_chat_attachment
    from fastapi import HTTPException

    body = ChatIn(content="Summarize", document_mime_type="application/pdf", document_data=base64.b64encode(b"not pdf").decode())
    with pytest.raises(HTTPException, match="file type does not match"):
        decode_chat_attachment(body)
