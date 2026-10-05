from __future__ import annotations

import os
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes_auth import router as auth_router, require_session
from app.api.routes_export import router as export_router
from app.api.routes_palette import router as palette_router
from app.api.routes_conversion import router as conversion_router


app = FastAPI(
    title="Perlabo Web API",
    version="0.4.0",
    description="独立 Web 图像准备、图纸生成、色卡与导出 API。",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "PINDOU_CORS_ORIGINS",
        "http://127.0.0.1:5180,http://localhost:5180",
    ).split(",")
    if origin.strip()
]
PROTECTED_PATHS = {
    "/api/auth/quota", "/api/pattern/prepare", "/api/pattern/convert",
    "/api/palette", "/api/export/png", "/api/export/pdf",
}


@app.middleware("http")
async def request_boundary(request: Request, call_next):
    request.state.started = time.monotonic()
    if request.method != "OPTIONS" and request.url.path.rstrip("/") in PROTECTED_PATHS:
        try:
            request.state.user_id = require_session(request)
            length = int(request.headers.get("content-length", "0"))
            if length < 0:
                raise ValueError("negative length")
            if length > 4 * 1024 * 1024 + 65536:
                raise HTTPException(413, "请求超过大小上限")
        except ValueError:
            return JSONResponse({"detail": "请求大小无效"}, status_code=400)
        except HTTPException as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code,
                                headers=exc.headers)
    response = await call_next(request)
    if request.url.path.rstrip("/") in PROTECTED_PATHS:
        response.headers["Cache-Control"] = "no-store"
    return response


# CORS is outermost, so preflights and authentication failures have CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)

app.include_router(auth_router)
app.include_router(export_router)
app.include_router(palette_router)
app.include_router(conversion_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "perlabo-web", "version": app.version}
