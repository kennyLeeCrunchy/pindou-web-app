import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.api_main import app

from app.api.routes_export import ExportColor, ExportPngRequest, export_pdf, export_png


class ExportApiTests(unittest.TestCase):
    def test_http_export_validates_cells_and_requires_authorization(self):
        token = "web-test-token-" + "x" * 40
        body = {"width": 2, "height": 2, "cells": [["A01", None], ["A01", "A02"]], "colors": [{"code": "A01", "hex": "#112233"}, {"code": "A02", "hex": "#F0E0D0"}]}
        with patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": token}):
            client = TestClient(app)
            for kind, signature in (("png", b"\x89PNG"), ("pdf", b"%PDF")):
                self.assertEqual(client.post(f"/api/export/{kind}", json=body).status_code, 401)
                response = client.post(f"/api/export/{kind}", json=body, headers={"Authorization": f"Bearer {token}"})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertTrue(response.content.startswith(signature))
            body["cells"][0][0] = "UNKNOWN"
            invalid = client.post("/api/export/png", json=body, headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(invalid.status_code, 400)

    def test_export_cannot_load_a_runtime_pattern(self):
        token = "web-test-token-" + "x" * 40
        with patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": token}):
            client = TestClient(app, headers={"Authorization": f"Bearer {token}"})
            response = client.post("/api/export/png", json={"pattern_id": "a" * 32})
        self.assertEqual(response.status_code, 400)

    def test_export_png_accepts_edited_pattern_cells(self):
        response = export_png(
            ExportPngRequest(
                width=2,
                height=2,
                cells=[["A01", None], ["A01", "A02"]],
                colors=[
                    ExportColor(code="A01", hex="#112233", name="深色"),
                    ExportColor(code="A02", hex="#F0E0D0", name="浅色"),
                ],
            )
        )

        self.assertEqual(response.media_type, "image/png")
        self.assertTrue(response.body.startswith(b"\x89PNG"))

    def test_export_pdf_accepts_edited_pattern_cells(self):
        response = export_pdf(
            ExportPngRequest(
                width=2,
                height=2,
                cells=[["A01", None], ["A01", "A02"]],
                colors=[
                    ExportColor(code="A01", hex="#112233", name="深色"),
                    ExportColor(code="A02", hex="#F0E0D0", name="浅色"),
                ],
            )
        )

        self.assertEqual(response.media_type, "application/pdf")
        self.assertTrue(response.body.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
