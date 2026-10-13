from pathlib import Path
from types import SimpleNamespace

from app.routers import system


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
