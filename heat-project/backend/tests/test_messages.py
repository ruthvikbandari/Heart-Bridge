def test_message_permissions_block_and_requests(client):
    maya = client.post("/api/auth/register", json={"email": "maya@example.com", "password": "Password1", "display_name": "Maya"})
    maya_id = maya.json()["id"]
    arun = client.__class__(client.app)
    arun.post("/api/auth/register", json={"email": "arun@example.com", "password": "Password1", "display_name": "Arun"})
    leila = client.__class__(client.app)
    leila.post("/api/auth/register", json={"email": "leila@example.com", "password": "Password1", "display_name": "Leila"})

    created = arun.post("/api/message-requests", json={"recipient_id": maya_id, "body": "Hello, may I talk?"})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    assert leila.get(f"/api/conversations/{conversation_id}/messages").status_code == 404

    extra = arun.post(f"/api/conversations/{conversation_id}/messages", json={"body": "Another note"})
    assert extra.status_code == 403

    accepted = client.post(f"/api/conversations/{conversation_id}/accept")
    assert accepted.status_code == 200
    sent = arun.post(f"/api/conversations/{conversation_id}/messages", json={"body": "Thank you for accepting."})
    assert sent.status_code == 200
    inbox = client.get("/api/conversations").json()
    match = next(item for item in inbox["items"] if item["id"] == conversation_id)
    assert match["unread"] >= 1
    assert client.post(f"/api/conversations/{conversation_id}/read").json()["ok"] is True

    blocked = client.post("/api/blocks", json={"user_id": arun.get("/api/me").json()["id"]})
    assert blocked.status_code == 200
    denied = arun.post(f"/api/conversations/{conversation_id}/messages", json={"body": "Are you there?"})
    assert denied.status_code in {403, 404}
