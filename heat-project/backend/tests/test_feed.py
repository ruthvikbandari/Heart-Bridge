from tests.conftest import register


def auth_client(client, email, name):
    register(client, email=email, password="Password1", name=name)
    return client


def test_private_post_is_hidden(client):
    auth_client(client, "owner@example.com", "Owner")
    created = client.post("/api/posts", json={"body": "A private draft", "visibility": "private", "topics": ["sleep"]})
    assert created.status_code == 200
    post_id = created.json()["id"]

    other = client.__class__(client.app)
    register(other, email="other@example.com", password="Password1", name="Other")
    hidden = other.get(f"/api/posts/{post_id}")
    assert hidden.status_code == 404
    feed = other.get("/api/posts?tab=latest")
    assert all(item["id"] != post_id for item in feed.json()["items"])


def test_community_visibility_and_reactions(client):
    register(client, email="mod@example.com", password="Password1", name="Mod")
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import User

    db = SessionLocal()
    user = db.scalars(select(User).where(User.email == "mod@example.com")).one()
    user.role = "moderator"
    db.commit()
    db.close()

    community = client.post(
        "/api/communities",
        json={
            "name": "Sleep Room",
            "description": "Public sleep topic",
            "guidelines": "Be kind",
            "topic": "sleep",
            "visibility": "public",
            "allow_anonymous": True,
        },
    )
    assert community.status_code == 200, community.text
    community_id = community.json()["id"]
    post = client.post(
        "/api/posts",
        json={
            "body": "Nights are long.",
            "visibility": "community",
            "community_id": community_id,
            "topics": ["sleep"],
            "is_anonymous": True,
        },
    )
    assert post.status_code == 200, post.text

    outsider = client.__class__(client.app)
    register(outsider, email="out@example.com", password="Password1", name="Out")
    assert outsider.get(f"/api/posts/{post.json()['id']}").status_code == 404
    joined = outsider.post(f"/api/communities/{community_id}/join", json={})
    assert joined.status_code == 200
    visible = outsider.get(f"/api/posts/{post.json()['id']}")
    assert visible.status_code == 200
    assert visible.json()["author"]["anonymous"] is True
    reacted = outsider.post(f"/api/posts/{post.json()['id']}/reactions", json={"reaction_type": "hear"})
    assert reacted.status_code == 200
    assert reacted.json()["reactions"]["hear"] == 1
    comment = outsider.post(f"/api/posts/{post.json()['id']}/comments", json={"body": "I hear the long nights."})
    assert comment.status_code == 200
    saved = outsider.post(f"/api/posts/{post.json()['id']}/bookmark")
    assert saved.json()["bookmarked"] is True
    report = outsider.post(
        "/api/reports",
        json={"target_type": "post", "target_id": post.json()["id"], "reason": "Spam", "details": ""},
    )
    assert report.status_code == 200


def test_for_you_uses_only_selected_topics(client):
    register(client, email="reader@example.com", password="Password1", name="Reader")
    client.post(
        "/api/me/onboarding",
        json={"display_name": "Reader", "language": "en", "interests": ["anxiety"], "consents": {"personalize_feed": True}},
    )
    client.post("/api/posts", json={"body": "Anxiety note", "visibility": "public", "topics": ["anxiety"]})
    client.post("/api/posts", json={"body": "Diabetes note", "visibility": "public", "topics": ["diabetes"]})
    for_you = client.get("/api/posts?tab=for_you").json()
    bodies = [item["body"] for item in for_you["items"]]
    assert "Anxiety note" in bodies
    assert "Diabetes note" not in bodies
    assert for_you["personalized"] is True
    latest = client.get("/api/posts?tab=latest").json()
    assert "Diabetes note" in [item["body"] for item in latest["items"]]

    client.patch("/api/privacy/consents", json={"consents": {"personalize_feed": False}})
    broad = client.get("/api/posts?tab=for_you").json()
    assert broad["personalized"] is False
    assert "Diabetes note" in [item["body"] for item in broad["items"]]
