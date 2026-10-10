from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", ROOT_DIR / ".env"),
        extra="ignore",
    )

    database_url: str = "sqlite:///./heartbridge.db"
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7
    cookie_secure: bool = False
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    allow_localhost_origin: bool = True
    demo_banner: bool = True
    rate_limit_enabled: bool = True
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    ai_timeout_seconds: float = 45
    ai_max_tokens: int = 1200
    ai_stream_delay: float = 0.012
    upload_dir: str = "uploads"

    @property
    def origins(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]

    @property
    def ai_live(self) -> bool:
        return self.ai_provider_name != "heartbridge-demo"

    @property
    def ai_provider_name(self) -> str:
        if self.gemini_api_key.strip():
            return "gemini"
        if self.openai_api_key.strip():
            return "openai"
        return "heartbridge-demo"


@lru_cache
def get_settings() -> Settings:
    return Settings()
