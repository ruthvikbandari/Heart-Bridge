import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-heartbridge"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["AI_STREAM_DELAY"] = "0"
os.environ["GEMINI_API_KEY"] = ""
os.environ["OPENAI_API_KEY"] = ""
os.environ["DEMO_BANNER"] = "true"
os.environ["ALLOW_LOCALHOST_ORIGIN"] = "true"

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.database import Base, engine

get_settings.cache_clear()
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def register(client, email="asha@example.com", password="Password1", name="Asha"):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "display_name": name},
    )
    assert response.status_code == 200, response.text
    return response.json()
