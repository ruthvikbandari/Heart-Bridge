import pytest
from sqlalchemy import create_engine

from app.config import Settings


@pytest.mark.parametrize(
    ("database_url", "expected"),
    [
        (
            "postgres://user:pass@host/db?sslmode=require",
            "postgresql+psycopg://user:pass@host/db?sslmode=require",
        ),
        (
            "postgresql://user:pass@host/db?sslmode=require",
            "postgresql+psycopg://user:pass@host/db?sslmode=require",
        ),
        (
            "postgresql+psycopg://user:pass@host/db?sslmode=require",
            "postgresql+psycopg://user:pass@host/db?sslmode=require",
        ),
        ("sqlite:///./heartbridge.db", "sqlite:///./heartbridge.db"),
    ],
)
def test_database_url_normalization(database_url, expected):
    assert Settings(database_url=database_url).database_url == expected


def test_neon_url_uses_psycopg_driver():
    engine = create_engine(
        Settings(database_url="postgresql://user:pass@host/db?sslmode=require").database_url
    )
    try:
        assert engine.dialect.name == "postgresql"
        assert engine.dialect.driver == "psycopg"
    finally:
        engine.dispose()
