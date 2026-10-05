"""Quota facade; hosting adapters are selected explicitly, never by SDK presence."""
from __future__ import annotations
import os
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException


def _daily_limit() -> int:
    try:
        limit = int(os.getenv("PINDOU_RATE_MAX_CONVERSIONS", "20"))
    except ValueError as exc:
        raise HTTPException(503, "服务额度配置错误") from exc
    if not 1 <= limit <= 100:
        raise HTTPException(503, "服务额度配置错误")
    return limit


def _backend():
    selected = os.getenv("PINDOU_QUOTA_BACKEND", "").strip().lower()
    if selected == "local":
        from app.platform import local_quota
        return local_quota
    if selected == "cloudbase":
        from app.platform import cloudbase_quota
        return cloudbase_quota
    raise HTTPException(503, "请明确配置额度后端 local 或 cloudbase")


def _today() -> str:
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")


def get_quota(user_id: str) -> dict:
    return _backend().get_quota(user_id, _today(), _daily_limit())


def consume_quota(user_id: str, request_id: str) -> None:
    # Call in the API parent process before spawning image workers.
    _backend().consume_quota(user_id, request_id, _today(), _daily_limit())
