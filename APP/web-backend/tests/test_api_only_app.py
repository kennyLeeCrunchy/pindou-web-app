import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.api_main import app

TOKEN = "web-test-token-" + "x" * 40


class ApiOnlyAppTests(unittest.TestCase):
    def setUp(self):
        config = patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": TOKEN})
        config.start()
        self.addCleanup(config.stop)
        self.client = TestClient(app)

    def test_public_health_identifies_web(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertIn("web", response.json()["service"].lower())

    def test_web_palette_requires_bearer(self):
        self.assertEqual(self.client.get("/api/palette").status_code, 401)
        response = self.client.get("/api/palette", params={"brand": "Mard"}, headers={"Authorization": f"Bearer {TOKEN}"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["brand"], "Mard")

    def test_legacy_routes_and_generated_files_are_not_exposed(self):
        for path in ("/", "/generated/old.png", "/runtime/generated/old.png", "/api/pattern/media/old.png", "/api/style-reference/qpixel-comparison.png"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 404)
        for path in ("/api/auth/login", "/api/ai/generate", "/api/ai/clean-reference", "/api/pattern/generate", "/api/pattern/bundle"):
            with self.subTest(path=path):
                self.assertEqual(self.client.post(path, json={}).status_code, 404)

    def test_cors_preflight_needs_no_token(self):
        response = self.client.options("/api/pattern/prepare", headers={"Origin": "http://localhost:5180", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5180")
        self.assertIn("authorization", response.headers["access-control-allow-headers"].lower())

    def test_unapproved_cors_origin_is_not_allowed(self):
        response = self.client.options("/api/pattern/prepare", headers={"Origin": "https://unapproved.example", "Access-Control-Request-Method": "POST"})
        self.assertNotIn("access-control-allow-origin", response.headers)


if __name__ == "__main__":
    unittest.main()
