import base64
import io
import os
import unittest
from collections import Counter
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from app.api import routes_conversion as route
from app.api_main import app
from app.core.config import MARD_PALETTE_PATH
from app.core.palette import load_mard_palette

TOKEN = "web-test-token-" + "x" * 40


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        config = patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": TOKEN})
        config.start()
        self.addCleanup(config.stop)
        self.client = TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"})
        # Keep real decoding, quantization and export; avoid process isolation in tests.
        worker = patch.object(route, "_run_conversion", side_effect=lambda data, options, deadline: route._build_result(data, options, deadline))
        worker.start()
        self.addCleanup(worker.stop)

    def test_prepare_convert_and_edited_export_contract(self):
        output = io.BytesIO()
        Image.new("RGB", (64, 48), "#D96B3B").save(output, format="PNG")
        with patch.object(route, "DashScopeImageEditClient", side_effect=AssertionError("direct route must not call paid AI")), patch.object(route, "check_rate_limit") as quota:
            prepared = self.client.post("/api/pattern/prepare", files={"image": ("scene.png", output.getvalue(), "image/png")}, data={"request_id": "web-prepare-request-000001", "mode": "scene_direct"})
            self.assertEqual(prepared.status_code, 200, prepared.text)
            payload = prepared.json()
            self.assertEqual(payload["phase"], "prepared")
            self.assertEqual(payload["ai_passes"], 0)
            source = base64.b64decode(payload["prepared_image_url"].split(",", 1)[1])
            converted = self.client.post("/api/pattern/convert", files={"image": ("prepared.png", source, "image/png")}, data={"request_id": "web-convert-request-000001", "mode": "scene_direct", "brand": "Mard", "max_colors": "8", "color_selection": "manual"})
            self.assertEqual(converted.status_code, 200, converted.text)
            quota.assert_not_called()
        pattern = converted.json()
        self.assertEqual([v["width"] for v in pattern["variants"]], [52, 78, 104])
        self.assertEqual(pattern["max_colors"], 8)
        self.assertEqual(pattern["ai_passes"], 0)
        palette = load_mard_palette(MARD_PALETTE_PATH)
        for variant in pattern["variants"]:
            counts = Counter(code for row in variant["cells"] for code in row if code)
            self.assertEqual(dict(counts), {item["code"]: item["count"] for item in variant["counts"]})
            self.assertLessEqual(len(counts), 8)
            for item in variant["counts"]:
                self.assertEqual(item["hex"].upper(), palette[item["code"]].hex.upper())
        first = pattern["variants"][0]
        edited_cells = [row[:] for row in first["cells"]]
        edited_cells[0][0] = None
        exported = self.client.post("/api/export/png", json={"width": first["width"], "height": first["height"], "cells": edited_cells, "colors": [{"code": row["code"], "hex": row["hex"], "name": row["name"]} for row in first["counts"]]})
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertTrue(exported.content.startswith(b"\x89PNG"))
        self.assertIn("attachment", exported.headers["content-disposition"])

    def test_palette_endpoint_returns_mard_221_colors(self):
        response = self.client.get("/api/palette", params={"brand": "Mard"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["colors"]), 221)
        self.assertEqual(response.json()["colors"][0]["code"], "A1")


if __name__ == "__main__":
    unittest.main()
