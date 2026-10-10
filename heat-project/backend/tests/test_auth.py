def test_register_login_and_logout(client):
    created = client.post(
        "/api/auth/register",
        json={"email": "new@example.com", "password": "Password1", "display_name": "New Member"},
    )
    assert created.status_code == 200
    assert created.json()["email"] == "new@example.com"
    assert "password" not in created.json()
    assert client.get("/api/me").status_code == 200

    client.post("/api/auth/logout")
    assert client.get("/api/me").status_code == 401

    bad = client.post("/api/auth/login", json={"email": "new@example.com", "password": "wrongpass"})
    assert bad.status_code == 401
    good = client.post("/api/auth/login", json={"email": "new@example.com", "password": "Password1"})
    assert good.status_code == 200


def test_duplicate_email_and_weak_password(client):
    first = client.post(
        "/api/auth/register",
        json={"email": "same@example.com", "password": "Password1", "display_name": "Same"},
    )
    assert first.status_code == 200
    duplicate = client.post(
        "/api/auth/register",
        json={"email": "same@example.com", "password": "Password1", "display_name": "Other"},
    )
    assert duplicate.status_code == 409
    weak = client.post(
        "/api/auth/register",
        json={"email": "weak@example.com", "password": "password", "display_name": "Weak"},
    )
    assert weak.status_code == 422


def test_onboarding_saves_choices(client):
    client.post(
        "/api/auth/register",
        json={"email": "onboard@example.com", "password": "Password1", "display_name": "Onboard"},
    )
    response = client.post(
        "/api/me/onboarding",
        json={
            "display_name": "Onboard User",
            "language": "hi",
            "bio": "A short bio",
            "interests": ["sleep"],
            "consents": {"use_profile_in_ai": True, "appear_in_suggestions": False},
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["onboarded"] is True
    assert body["profile"]["language"] == "hi"
    assert body["interests"] == ["sleep"]
    assert body["consents"]["use_profile_in_ai"] is True
    assert body["consents"]["personalize_feed"] is True


def test_forgot_password_reset_flow(client):
    client.post(
        "/api/auth/register",
        json={"email": "reset@example.com", "password": "Password1", "display_name": "Reset"},
    )

    request = client.post("/api/auth/forgot-password", json={"email": "reset@example.com"})
    assert request.status_code == 200
    payload = request.json()
    assert payload["ok"] is True
    assert "reset_token" in payload

    updated = client.post(
        "/api/auth/reset-password",
        json={"email": "reset@example.com", "token": payload["reset_token"], "password": "NewPassword2"},
    )
    assert updated.status_code == 200

    old_password = client.post("/api/auth/login", json={"email": "reset@example.com", "password": "Password1"})
    assert old_password.status_code == 401

    new_password = client.post("/api/auth/login", json={"email": "reset@example.com", "password": "NewPassword2"})
    assert new_password.status_code == 200
