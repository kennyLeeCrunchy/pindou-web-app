"""CloudBase persistence adapter; imported only when explicitly selected."""
from __future__ import annotations
import json
import logging
import os
import re
from functools import lru_cache
from fastapi import HTTPException
logger = logging.getLogger(__name__)


def _collection() -> str:
    name = os.getenv("PINDOU_WEB_QUOTA_COLLECTION", "pindou_web_quota")
    if name == "pindou_quota" or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name):
        raise HTTPException(503, "Web 额度集合配置无效，必须独立于小程序")
    return name

@lru_cache(maxsize=1)
def _client():
    from tencentcloud.common import credential
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.tcb.v20180608.tcb_client import TcbClient

    credentials = credential.Credential(
        os.environ["PINDOU_TCB_SECRET_ID"], os.environ["PINDOU_TCB_SECRET_KEY"],
        os.getenv("PINDOU_TCB_SESSION_TOKEN"),
    )
    profile = ClientProfile(httpProfile=HttpProfile(reqTimeout=4))
    return TcbClient(credentials, os.getenv("PINDOU_TCB_REGION", "ap-shanghai"), profile)


def _decode_json(raw: str):
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = json.loads(json.loads('"' + raw + '"'))
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            result = json.loads(json.loads('"' + result + '"'))
    return result


def _parse_update(raw: str) -> dict:
    result = _decode_json(raw)
    if isinstance(result, list):
        if len(result) != 1:
            raise ValueError("Expected one quota update result")
        result = result[0]
    if isinstance(result, str):
        result = _decode_json(result)
    if not isinstance(result, dict):
        raise ValueError("Invalid quota update result")
    for key in ("ok", "nModified"):
        value = result.get(key)
        if isinstance(value, dict) and len(value) == 1:
            for numeric_type in ("$numberInt", "$numberLong", "$numberDouble"):
                if numeric_type in value:
                    result[key] = float(value[numeric_type])
    if result.get("ok") != 1 or result.get("writeErrors"):
        raise RuntimeError("Quota database update failed")
    return result


def _execute(command: dict, command_type: str = "UPDATE") -> str:
    from tencentcloud.tcb.v20180608.models import RunCommandsRequest

    request = RunCommandsRequest()
    request.from_json_string(json.dumps({
        "EnvId": os.environ["CLOUDBASE_ENV_ID"],
        "MgoCommands": [{"TableName": _collection(), "CommandType": command_type, "Command": json.dumps(command)}],
    }))
    response = _client().RunCommands(request)
    return response.Data[0]


def _run(command: dict) -> dict:
    return _parse_update(_execute(command))


def get_quota(user_id: str, today: str, limit: int) -> dict:
    try:
        rows = _decode_json(_execute({
            "find": _collection(), "filter": {"_id": user_id},
            "projection": {"_id": 0, "day": 1, "used": 1, "unlimited": 1}, "limit": 1,
        }, "QUERY"))
        if not isinstance(rows, list) or len(rows) > 1:
            raise ValueError("Invalid quota query result")
        record = _decode_json(rows[0]) if rows and isinstance(rows[0], str) else (rows[0] if rows else {})
        if not isinstance(record, dict):
            raise ValueError("Invalid quota record")
        used = record.get("used", 0) if record.get("day") == today else 0
        if isinstance(used, dict) and len(used) == 1:
            numeric_type, value = next(iter(used.items()))
            if numeric_type not in {"$numberInt", "$numberLong", "$numberDouble"}:
                raise ValueError("Invalid quota numeric type")
            used = float(value)
        if isinstance(used, bool) or not isinstance(used, (int, float)) or used < 0 or int(used) != used:
            raise ValueError("Invalid quota usage")
        used = int(used)
        unlimited = record.get("unlimited") is True
        return {"day": today, "limit": limit, "used": used,
                "remaining": None if unlimited else max(0, limit - used), "unlimited": unlimited}
    except Exception as exc:
        logger.error("Quota query failure type=%s code=%s request_id=%s", type(exc).__name__,
                     getattr(exc, "code", None), getattr(exc, "requestId", None))
        raise HTTPException(503, "额度暂时无法查询，请稍后重试") from exc


def consume_quota(user_id: str, request_id: str, today: str, limit: int) -> None:
    try:
        # Idempotent initialization, including concurrent first requests.
        _run({"update": _collection(), "updates": [{
            "q": {"_id": user_id}, "u": {"$setOnInsert": {"day": today, "used": 0, "requests": []}}, "upsert": True,
        }]})
        _run({"update": _collection(), "updates": [{
            "q": {"_id": user_id, "day": {"$lt": today}},
            "u": {"$set": {"day": today, "used": 0, "requests": []}},
        }]})
        result = _run({"update": _collection(), "updates": [{
            "q": {"_id": user_id, "day": today, "requests": {"$ne": request_id},
                  "$or": [{"used": {"$lt": limit}}, {"unlimited": True}]},
            "u": {"$inc": {"used": 1}, "$push": {"requests": request_id}},
        }]})
    except Exception as exc:
        # Fail closed: never bypass quota when persistence is unavailable.
        # Only log exception type and SDK identifiers; never credentials or records.
        logger.error("Quota failure type=%s code=%s request_id=%s", type(exc).__name__,
                     getattr(exc, "code", None), getattr(exc, "requestId", None))
        raise HTTPException(503, "额度服务暂不可用，请稍后重试") from exc
    if result.get("nModified") != 1:
        raise HTTPException(429, "今日额度已用完或此请求已提交，请勿重复生成")
