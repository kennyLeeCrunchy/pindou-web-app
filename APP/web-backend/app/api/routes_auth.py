"""Restricted Web access; public login and registration are not implemented."""
from __future__ import annotations
import hashlib
import hmac
import os
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from app.core.cloudbase_quota import consume_quota, get_quota
router = APIRouter(tags=["auth"])


def require_session(request: Request) -> str:
    """Validate a separately provisioned Web bearer credential, never a WX token."""
    expected = os.getenv("PINDOU_WEB_ACCESS_TOKEN", "")
    if len(expected) < 32 or any(character.isspace() for character in expected):
        raise HTTPException(503, "服务端 Web 访问凭据未配置")
    header = request.headers.get("Authorization", "")
    scheme, separator, token = header.partition(" ")
    if len(header) > 4096 or not separator or scheme.lower() != "bearer" or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(401, "Web 访问凭据无效", headers={"WWW-Authenticate": "Bearer"})
    return hashlib.sha256(("pindou-web-v1:" + expected).encode()).hexdigest()


def check_rate_limit(user_id: str, request_id: str) -> None:
    consume_quota(user_id, request_id)


@router.get("/api/auth/quota")
def quota_status(request: Request) -> JSONResponse:
    return JSONResponse(get_quota(require_session(request)), headers={"Cache-Control": "no-store"})
