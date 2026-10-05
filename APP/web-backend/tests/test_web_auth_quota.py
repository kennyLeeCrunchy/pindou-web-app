import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from app.api.routes_auth import require_session
from app.core import cloudbase_quota
from app.platform import cloudbase_quota as cloud_adapter, local_quota


class WebAuthQuotaTests(unittest.TestCase):
    def setUp(self):
        local_quota._records.clear()

    def test_wechat_header_never_authenticates_web(self):
        request = Request({"type": "http", "headers": [(b"x-session-token", b"old-wx-token")]})
        with patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": "w" * 40}):
            with self.assertRaises(HTTPException) as raised:
                require_session(request)
        self.assertEqual(raised.exception.status_code, 401)

    def test_backend_selection_is_explicit(self):
        for selected in ("", "automatic", "sqlite"):
            with self.subTest(selected=selected), patch.dict(os.environ, {"PINDOU_QUOTA_BACKEND": selected}):
                with self.assertRaises(HTTPException) as raised:
                    cloudbase_quota.get_quota("u")
                self.assertEqual(raised.exception.status_code, 503)

    def test_cloud_collection_cannot_reuse_miniprogram_default(self):
        with patch.dict(os.environ, {"PINDOU_WEB_QUOTA_COLLECTION": "pindou_quota"}):
            with self.assertRaises(HTTPException) as raised:
                cloud_adapter._collection()
        self.assertEqual(raised.exception.status_code, 503)

    def test_local_quota_is_atomic_under_concurrent_consumption(self):
        def consume(index):
            try:
                local_quota.consume_quota("u", str(index), "2026-10-04", 3)
                return True
            except HTTPException as exc:
                self.assertEqual(exc.status_code, 429)
                return False
        with ThreadPoolExecutor(max_workers=8) as executor:
            self.assertEqual(sum(executor.map(consume, range(12))), 3)
        self.assertEqual(local_quota.get_quota("u", "2026-10-04", 3)["used"], 3)

    def test_local_daily_reset_and_duplicate_rejection(self):
        local_quota.consume_quota("u", "same", "2026-10-04", 2)
        with self.assertRaises(HTTPException) as raised:
            local_quota.consume_quota("u", "same", "2026-10-04", 2)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(local_quota.get_quota("u", "2026-10-04", 2)["used"], 1)
        self.assertEqual(local_quota.get_quota("u", "2026-10-05", 2)["used"], 0)
        local_quota.consume_quota("u", "same", "2026-10-05", 2)
        self.assertEqual(local_quota.get_quota("u", "2026-10-05", 2)["used"], 1)
