from types import SimpleNamespace

import pytest


def registered_client(client):
    response = client.post(
        "/api/auth/register",
        json={"email": "ecg@example.com", "password": "Password1", "display_name": "Ari"},
    )
    assert response.status_code == 200, response.text
    return client


def test_ecg_analysis_requires_sign_in(client):
    response = client.post(
        "/api/ai/ecg-analysis",
        files={"file": ("report.pdf", b"%PDF-1.4\n", "application/pdf")},
    )

    assert response.status_code == 401


def test_ecg_analysis_requires_live_gemini(client):
    registered_client(client)

    response = client.post(
        "/api/ai/ecg-analysis",
        files={"file": ("report.pdf", b"%PDF-1.4\n", "application/pdf")},
    )

    assert response.status_code == 503
    assert "No report was analyzed" in response.json()["detail"]


def test_ecg_analysis_rejects_mismatched_file_contents(client, monkeypatch):
    registered_client(client)
    monkeypatch.setattr(
        "app.routers.ai.get_settings",
        lambda: SimpleNamespace(ai_provider_name="gemini"),
    )

    response = client.post(
        "/api/ai/ecg-analysis",
        files={"file": ("report.pdf", b"not a PDF", "application/pdf")},
    )

    assert response.status_code == 400
    assert "does not match its contents" in response.json()["detail"]


def test_ecg_analysis_passes_attachment_to_gemini_without_saving(client, monkeypatch):
    registered_client(client)
    monkeypatch.setattr(
        "app.routers.ai.get_settings",
        lambda: SimpleNamespace(ai_provider_name="gemini"),
    )
    requests = []

    class TestProvider:
        is_demo = False

        async def stream(self, request):
            requests.append(request)
            yield "The report's printed interpretation says normal sinus rhythm."

    monkeypatch.setattr("app.routers.ai.get_provider", TestProvider)
    report = b"%PDF-1.4\nECG report"

    response = client.post(
        "/api/ai/ecg-analysis",
        data={"question": "What does the printed interpretation mean?"},
        files={"file": ("report.pdf", report, "application/pdf")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert "normal sinus rhythm" in body["analysis"]
    assert "not a diagnosis" in body["disclaimer"]
    assert len(requests) == 1
    generation = requests[0]
    assert generation.history[0]["content"] == "What does the printed interpretation mean?"
    assert "Do not diagnose" in generation.profile_note
    assert "untrusted data" in generation.profile_note
    assert generation.attachment.mime_type == "application/pdf"
    assert generation.attachment.data
    assert generation.attachment.data != report.decode("latin-1")
    assert generation.profile_note.startswith("Do not use profile details")


def test_ecg_diagnosis_question_is_handled_without_calling_provider(client, monkeypatch):
    registered_client(client)
    monkeypatch.setattr(
        "app.routers.ai.get_settings",
        lambda: SimpleNamespace(ai_provider_name="gemini"),
    )

    class UnexpectedProvider:
        is_demo = False

        async def stream(self, _request):
            pytest.fail("The provider must not receive a diagnosis request.")
            yield ""

    monkeypatch.setattr("app.routers.ai.get_provider", UnexpectedProvider)
    response = client.post(
        "/api/ai/ecg-analysis",
        data={"question": "What disease do I have?"},
        files={"file": ("report.pdf", b"%PDF-1.4\n", "application/pdf")},
    )

    assert response.status_code == 200
    assert response.json()["safety"] == "diagnosis"
    assert "can't diagnose" in response.json()["analysis"]


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [("report.exe", "application/pdf"), ("report.pdf", "application/octet-stream")],
)
def test_ecg_analysis_rejects_unsupported_file_types(client, monkeypatch, filename, content_type):
    registered_client(client)
    monkeypatch.setattr(
        "app.routers.ai.get_settings",
        lambda: SimpleNamespace(ai_provider_name="gemini"),
    )

    response = client.post(
        "/api/ai/ecg-analysis",
        files={"file": (filename, b"%PDF-1.4\n", content_type)},
    )

    assert response.status_code == 400
