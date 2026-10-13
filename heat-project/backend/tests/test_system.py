from pathlib import Path
from types import SimpleNamespace

from app.config import get_settings
from app.routers import system


def test_production_frontend_origin_is_allowed():
    assert "https://heart-bridge-flame.vercel.app" in get_settings().origins


def test_other_vercel_origins_are_not_implicitly_allowed():
    assert "https://another-project.vercel.app" not in get_settings().origins


def test_upload_root_uses_temporary_directory_on_vercel(tmp_path, monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(system, "get_settings", lambda: SimpleNamespace(upload_dir="uploads"))
    monkeypatch.setattr(system.tempfile, "gettempdir", lambda: str(tmp_path))

    root = system.upload_root()

    assert root == tmp_path / "uploads"
    assert root.is_dir()


def test_upload_root_keeps_backend_directory_outside_vercel(tmp_path, monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(system, "BACKEND_DIR", tmp_path)
    monkeypatch.setattr(system, "get_settings", lambda: SimpleNamespace(upload_dir="uploads"))

    root = system.upload_root()

    assert root == tmp_path / "uploads"
    assert root.is_dir()
