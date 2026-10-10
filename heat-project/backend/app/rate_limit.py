import time

from fastapi import HTTPException

from app.config import get_settings


class RateLimiter:
    def __init__(self) -> None:
        self.hits: dict[str, list[float]] = {}

    def check(self, key: str, limit: int, window: float = 60) -> None:
        if not get_settings().rate_limit_enabled:
            return
        now = time.time()
        bucket = [stamp for stamp in self.hits.get(key, []) if now - stamp < window]
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="Too many requests. Please wait a moment and try again.")
        bucket.append(now)
        self.hits[key] = bucket

    def reset(self) -> None:
        self.hits.clear()


limiter = RateLimiter()
