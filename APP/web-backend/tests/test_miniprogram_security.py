import io
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from starlette.requests import Request
from app.api import routes_auth, routes_conversion
from app.api_main import app
from app.platform import local_quota

TOKEN = "web-test-token-" + "x" * 40


class WebSecurityTests(unittest.TestCase):
    def setUp(self):
        config = patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": TOKEN, "PINDOU_QUOTA_BACKEND": "local", "PINDOU_RATE_MAX_CONVERSIONS": "2", "DASHSCOPE_API_KEY": "test-key"})
        config.start()
        self.addCleanup(config.stop)
        local_quota._records.clear()
        self.addCleanup(local_quota._records.clear)
        self.client = TestClient(app)
        self.headers = {"Authorization": f"Bearer {TOKEN}"}

    def test_business_routes_reject_missing_invalid_and_wx_credentials(self):
        for headers in ({}, {"Authorization": "Bearer wrong"}, {"X-Session-Token": TOKEN}):
            for method, path in (("get", "/api/auth/quota"), ("get", "/api/palette"), ("post", "/api/pattern/prepare"), ("post", "/api/pattern/convert"), ("post", "/api/export/png"), ("post", "/api/export/pdf")):
                with self.subTest(headers=headers, path=path):
                    response = getattr(self.client, method)(path, headers=headers)
                    self.assertEqual(response.status_code, 401, response.text)

    def test_missing_server_credential_fails_closed(self):
        for credential in ("", "too-short", "a" * 32 + " "):
            with self.subTest(credential=credential), patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": credential}):
                self.assertEqual(self.client.get("/api/auth/quota", headers=self.headers).status_code, 503)
                self.assertEqual(self.client.get("/api/health").status_code, 200)

    def test_invalid_credential_cannot_reach_model_or_quota(self):
        with patch.object(routes_conversion, "_run_conversion") as worker, patch.object(routes_conversion, "check_rate_limit") as quota:
            response = self.client.post("/api/pattern/prepare", data={"mode": "subject_cartoon"})
        self.assertEqual(response.status_code, 401)
        worker.assert_not_called()
        quota.assert_not_called()

    def test_quota_is_identity_scoped_and_has_no_cache(self):
        request = Request({"type": "http", "headers": [(b"authorization", f"Bearer {TOKEN}".encode())]})
        identity = routes_auth.require_session(request)
        self.assertRegex(identity, r"^[0-9a-f]{64}$")
        with patch.object(routes_auth, "get_quota", return_value={"limit": 2, "used": 0, "remaining": 2, "unlimited": False}) as query:
            response = self.client.get("/api/auth/quota?user_id=attacker", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        query.assert_called_once_with(identity)

    def test_ai_duplicate_is_rejected_before_second_worker_and_usage_persists(self):
        output = io.BytesIO()
        Image.new("RGB", (16, 16), "red").save(output, format="PNG")
        form = {"mode": "subject_cartoon", "request_id": "web-ai-request-00000001"}
        with patch.object(routes_conversion, "_run_conversion", return_value={"phase": "prepared"}) as worker:
            first = self.client.post("/api/pattern/prepare", headers=self.headers, files={"image": ("photo.png", output.getvalue(), "image/png")}, data=form)
            repeated = self.client.post("/api/pattern/prepare", headers=self.headers, files={"image": ("photo.png", output.getvalue(), "image/png")}, data=form)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(repeated.status_code, 429, repeated.text)
        worker.assert_called_once()
        queried = self.client.get("/api/auth/quota", headers=self.headers)
        self.assertEqual(queried.status_code, 200, queried.text)
        self.assertEqual(queried.json()["used"], 1)
        self.assertEqual(queried.json()["remaining"], 1)

    def test_failed_ai_attempt_still_consumes_quota(self):
        from fastapi import HTTPException
        output = io.BytesIO()
        Image.new("RGB", (16, 16), "red").save(output, format="PNG")
        with patch.object(routes_conversion, "_run_conversion", side_effect=HTTPException(502, "mock model failure")):
            response = self.client.post("/api/pattern/prepare", headers=self.headers, files={"image": ("photo.png", output.getvalue(), "image/png")}, data={"mode": "subject_cartoon", "request_id": "web-ai-failure-00000001"})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.client.get("/api/auth/quota", headers=self.headers).json()["used"], 1)

    def test_model_image_url_rejects_unapproved_hosts_before_network(self):
        for url in ("http://example.com/image.png", "https://127.0.0.1/image.png", "https://aliyun.com.attacker.example/image.png"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                routes_conversion.download_image(url, timeout=1)


if __name__ == "__main__":
    unittest.main()
