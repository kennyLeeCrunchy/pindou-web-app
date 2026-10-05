"""Single-process local quota for development; restarts reset these records."""
from __future__ import annotations
from threading import Lock
from fastapi import HTTPException
_records: dict[str, dict] = {}
_lock = Lock()


def get_quota(user_id: str, today: str, limit: int) -> dict:
    with _lock:
        record = _records.get(user_id, {})
        used = record.get("used", 0) if record.get("day") == today else 0
        return {"day": today, "limit": limit, "used": used,
                "remaining": max(0, limit - used), "unlimited": False}


def consume_quota(user_id: str, request_id: str, today: str, limit: int) -> None:
    with _lock:
        record = _records.setdefault(user_id, {"day": today, "used": 0, "requests": set()})
        if record["day"] != today:
            record.update(day=today, used=0, requests=set())
        if request_id in record["requests"] or record["used"] >= limit:
            raise HTTPException(429, "今日额度已用完或此请求已提交，请勿重复生成")
        record["used"] += 1
        record["requests"].add(request_id)
