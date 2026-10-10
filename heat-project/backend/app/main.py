import logging
import time
import uuid
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import admin, ai, auth, communities, doctors, messages, posts, privacy, system
from app.routers.system import upload_root
from app.services.realtime import set_main_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("heartbridge")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    import asyncio

    set_main_loop(asyncio.get_running_loop())
    upload_root()
    yield


settings = get_settings()
app = FastAPI(title="HeartBridge API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def origin_allowed(origin: str) -> bool:
    if origin in settings.origins:
        return True
    if not settings.allow_localhost_origin:
        return False
    parsed = urlparse(origin)
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"localhost", "127.0.0.1"}


@app.middleware("http")
async def protect(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and not origin_allowed(origin):
            return JSONResponse(status_code=403, content={"detail": "This request was blocked."})
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    logger.info(
        "%s %s %s %.0fms",
        request.method,
        request.url.path,
        response.status_code,
        (time.perf_counter() - started) * 1000,
    )
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    message = "Please check the form and try again."
    errors = exc.errors()
    if errors:
        first = errors[0]
        detail = first.get("msg", message)
        loc = [str(part) for part in first.get("loc", []) if part != "body"]
        message = f"{'.'.join(loc)}: {detail}" if loc else str(detail)
    return JSONResponse(status_code=422, content={"detail": message})


for module in (system, auth, posts, communities, messages, ai, doctors, privacy, admin):
    app.include_router(module.router, prefix="/api")

app.mount("/uploads", StaticFiles(directory=str(upload_root())), name="uploads")
