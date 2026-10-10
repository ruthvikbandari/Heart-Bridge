def test_suggestions_follow_consent(client):
    client.post("/api/auth/register", json={"email": "seeker@example.com", "password": "Password1", "display_name": "Seeker"})
    client.post(
        "/api/me/onboarding",
        json={"display_name": "Seeker", "language": "en", "interests": ["grief"], "consents": {"appear_in_suggestions": True}},
    )
    visible = client.__class__(client.app)
    visible.post("/api/auth/register", json={"email": "visible@example.com", "password": "Password1", "display_name": "Visible"})
    visible.post(
        "/api/me/onboarding",
        json={"display_name": "Visible", "language": "en", "interests": ["grief"], "consents": {"appear_in_suggestions": True}},
    )
    hidden = client.__class__(client.app)
    hidden.post("/api/auth/register", json={"email": "hidden@example.com", "password": "Password1", "display_name": "Hidden"})
    hidden.post(
        "/api/me/onboarding",
        json={"display_name": "Hidden", "language": "en", "interests": ["grief"], "consents": {"appear_in_suggestions": False}},
    )
    names = [item["profile"]["display_name"] for item in client.get("/api/users/suggestions").json()["items"]]
    assert "Visible" in names
    assert "Hidden" not in names
    assert "diagnosis" not in client.get("/api/users/suggestions").text.lower()


def test_export_and_delete_are_real(client):
    client.post("/api/auth/register", json={"email": "private@example.com", "password": "Password1", "display_name": "Private"})
    client.post("/api/posts", json={"body": "Please export this", "visibility": "public", "topics": ["sleep"]})
    client.post("/api/journal", json={"body": "A private reflection"})
    exported = client.post("/api/privacy/export-request")
    assert exported.status_code == 200
    text = exported.text
    assert "Please export this" in text
    assert "A private reflection" in text
    assert "pbkdf2" not in text
    assert "password_hash" not in text

    denied = client.request("DELETE", "/api/me", json={"password": "Password1", "confirm": "nope"})
    assert denied.status_code == 400
    removed = client.request("DELETE", "/api/me", json={"password": "Password1", "confirm": "DELETE"})
    assert removed.status_code == 200
    assert client.get("/api/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "private@example.com", "password": "Password1"}).status_code == 401
