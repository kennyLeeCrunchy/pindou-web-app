import base64
import io
import os
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageOps

from app.api_main import app
from app.api import routes_conversion as route
from app.core import bundle, smart_pattern, smart_pattern_f
from app.core.palette import PaletteColor
from app.core.quantizer import BeadPattern


def image_bytes(color="red"):
    output = io.BytesIO()
    Image.new("RGB", (40, 48), color).save(output, format="PNG")
    return output.getvalue()


def fake_variants(image, **kwargs):
    color = PaletteColor("H7", "H", "黑", "黑", "#000000", (0, 0, 0))
    results = []
    for width, height in kwargs["sizes"]:
        cells = [["H7" for _ in range(width)] for _ in range(height)]
        pattern = BeadPattern(width, height, cells, {"H7": width * height}, {"H7": color})
        results.append(SimpleNamespace(pattern=pattern, overall_score=90, passed=True, recommendation="测试"))
    return results


class WebConvertTests(unittest.TestCase):
    def setUp(self):
        # Exercise real Web authentication; all paid model requests remain mocked.
        auth = patch.dict(os.environ, {"PINDOU_WEB_ACCESS_TOKEN": "web-test-token-" + "x" * 40, "DASHSCOPE_API_KEY": "test-key"})
        quota = patch.object(route, "check_rate_limit")
        auth.start()
        quota.start()
        self.addCleanup(auth.stop)
        self.addCleanup(quota.stop)
        self.client = TestClient(app, headers={"Authorization": "Bearer web-test-token-" + "x" * 40})
        self.convert_id = 0
        worker = patch.object(route, "_run_conversion", side_effect=lambda data, options, deadline: route._build_result(data, options, deadline))
        worker.start()
        self.addCleanup(worker.stop)

    def convert(self, *, files, data=None):
        self.convert_id += 1
        form = {"request_id": f"test-request-{self.convert_id:016d}", **(data or {})}
        return self.client.post("/api/pattern/convert", files=files, data=form)

    def test_web_conversion_preserves_f_algorithm(self):
        self.assertIs(bundle.generate_smart_pattern, smart_pattern.generate_smart_pattern)
        self.assertIs(route.generate_smart_pattern_variants, smart_pattern_f.generate_smart_pattern_variants)
        self.assertIsNot(smart_pattern.generate_smart_pattern, smart_pattern_f.generate_smart_pattern)

    def test_all_style_reference_endpoints_are_removed(self):
        for name in ("nayeon-upper.png", "fullbody-stage-comparison.png", "qpixel-comparison.png"):
            self.assertEqual(self.client.get(f"/api/style-reference/{name}").status_code, 404)

    def test_pendant_sends_only_original_without_reference_guidance(self):
        uploaded = image_bytes("#cb5234")
        with (
            patch.object(route, "generate_smart_pattern_variants", side_effect=fake_variants) as generate,
            patch.object(route, "prepare_subject_image", return_value=SimpleNamespace(subject_bytes=uploaded, mask_method="demo_pixel_grabcut")),
            patch.object(route, "download_image", side_effect=lambda _, timeout: uploaded),
            patch.object(route, "DashScopeImageEditClient") as editor_class,
        ):
            editor_class.return_value.edit.return_value = ("model-task", "https://example.test/edited.png")
            response = self.convert(
                files={"image": ("person.png", uploaded, "image/png")},
                data={"mode": "subject_cartoon", "framing_mode": "pendant"},
            )
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["style_reference_urls"], [])
        self.assertIsNone(result["style_reference_color_mode"])
        self.assertEqual(result["model_input_image_count"], 1)
        self.assertEqual(result["ai_passes"], 1)
        self.assertEqual([item["width"] for item in result["variants"]], [52, 78, 104])
        self.assertEqual(generate.call_args.kwargs["max_colors"], 12)
        images = editor_class.return_value.edit.call_args.args[0]
        self.assertIsInstance(images, str)
        decoded = base64.b64decode(images.split(",", 1)[1])
        with Image.open(io.BytesIO(decoded)) as original:
            self.assertLessEqual(max(abs(a - b) for a, b in zip(original.convert("RGB").getpixel((0, 0)), (203, 82, 52))), 2)
        prompt_text = editor_class.return_value.edit.call_args.args[1]
        self.assertNotIn("参考图使用规则", prompt_text)
        self.assertNotIn("第 2 张", prompt_text)

    def test_prepare_then_repeat_patterns_keeps_full_source_and_calls_model_and_quota_once(self):
        output = io.BytesIO()
        Image.new("RGBA", (700, 600), (203, 82, 52, 255)).save(output, format="PNG")
        uploaded = output.getvalue()
        with (
            patch.object(route, "generate_smart_pattern_variants", side_effect=fake_variants) as generate,
            patch.object(route, "advise_color_budget", wraps=route.advise_color_budget) as advise,
            patch.object(route, "prepare_subject_image", return_value=SimpleNamespace(subject_bytes=uploaded, mask_method="test-alpha")),
            patch.object(route, "download_image", return_value=uploaded),
            patch.object(route, "check_rate_limit") as quota,
            patch.object(route, "DashScopeImageEditClient") as editor_class,
        ):
            editor_class.return_value.edit.return_value = ("model-task", "https://example.test/edited.png")
            first = self.client.post("/api/pattern/prepare", files={"image": ("photo.png", uploaded, "image/png")},
                data={"request_id": "prepare-request-00000001", "mode": "subject_cartoon", "framing_mode": "pendant"})
            self.assertEqual(first.status_code, 200, first.text)
            prepared = first.json()
            self.assertEqual(prepared["phase"], "prepared")
            self.assertNotIn("variants", prepared)
            self.assertEqual(prepared["model_input_image_count"], 1)
            generate.assert_not_called()
            advise.assert_not_called()
            full_png = base64.b64decode(prepared["prepared_image_url"].split(",", 1)[1])
            with Image.open(io.BytesIO(full_png)) as image:
                self.assertEqual(image.size, (700, 600))
            with Image.open(io.BytesIO(base64.b64decode(prepared["transparent_image_url"].split(",", 1)[1]))) as preview:
                self.assertEqual(max(preview.size), 512)
            for colors in (8, 24):
                result = self.convert(files={"image": ("prepared.png", full_png, "image/png")},
                    data={"mode": "cartoon_direct", "max_colors": str(colors), "color_selection": "manual"})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["max_colors"], colors)
                self.assertEqual(result.json()["ai_passes"], 0)
            self.assertEqual(editor_class.call_count, 1)
            self.assertEqual(editor_class.return_value.edit.call_count, 1)
            quota.assert_called_once()
            self.assertEqual(generate.call_count, 2)

    def test_auto_applies_advice_and_manual_remains_a_hard_budget(self):
        uploaded = image_bytes("#cb5234")
        advice = {"recommended_max_colors": 24, "recommendation_acceptable": True}
        with patch.object(route, "advise_color_budget", return_value=advice), patch.object(route, "generate_smart_pattern_variants", side_effect=fake_variants) as generate:
            for selection, expected in (("auto", 24), ("manual", 8)):
                result = self.convert(files={"image": ("scene.png", uploaded, "image/png")},
                    data={"mode": "scene_direct", "color_selection": selection, "max_colors": "8"})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["max_colors"], expected)
                self.assertEqual(result.json()["color_selection"], selection)
                self.assertEqual(generate.call_args.kwargs["max_colors"], expected)
            result = self.convert(files={"image": ("scene.png", uploaded, "image/png")}, data={"mode": "scene_direct"})
            self.assertEqual(result.json()["color_selection"], "auto")
        invalid = self.convert(files={"image": ("scene.png", uploaded, "image/png")}, data={"mode": "scene_direct", "color_selection": "bad"})
        self.assertEqual(invalid.status_code, 400)

    def test_flat_sends_only_original_and_direct_modes_skip_model(self):
        uploaded = image_bytes("#3499aa")
        with (
            patch.object(route, "generate_smart_pattern_variants", side_effect=fake_variants) as generate,
            patch.object(route, "prepare_subject_image", return_value=SimpleNamespace(subject_bytes=uploaded, mask_method="demo_pixel_grabcut")),
            patch.object(route, "download_image", side_effect=lambda _, timeout: uploaded),
            patch.object(route, "DashScopeImageEditClient") as editor_class,
        ):
            editor_class.return_value.edit.return_value = ("model-task", "https://example.test/edited.png")
            flat = self.convert(files={"image": ("person.png", uploaded, "image/png")}, data={"mode": "subject_cartoon", "framing_mode": "flat"})
            self.assertEqual(flat.status_code, 200, flat.text)
            self.assertIsInstance(editor_class.return_value.edit.call_args.args[0], str)
            self.assertEqual(flat.json()["model_input_image_count"], 1)
            self.assertEqual(flat.json()["style_reference_urls"], [])
            editor_class.return_value.edit.reset_mock()
            cartoon = self.convert(files={"image": ("cartoon.png", uploaded, "image/png")}, data={"mode": "cartoon_direct"})
            scene = self.convert(files={"image": ("scene.png", uploaded, "image/png")}, data={"mode": "scene_direct"})
            self.assertEqual(cartoon.status_code, 200, cartoon.text)
            self.assertEqual(scene.status_code, 200, scene.text)
            editor_class.return_value.edit.assert_not_called()
            self.assertEqual(cartoon.json()["ai_passes"], 0)
            self.assertEqual(scene.json()["ai_passes"], 0)
            self.assertEqual(generate.call_args.kwargs["max_colors"], 24)

    def test_subject_routes_use_shared_grabcut_keep_white_shirt_and_never_call_birefnet(self):
        from app.core.pixel_subject import extract_pixel_subject

        image = Image.new("RGB", (128, 128), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((48, 15, 80, 35), fill="#d38d5f")
        draw.rectangle((32, 36, 96, 78), fill="white", outline="#999999", width=3)
        draw.rectangle((38, 79, 55, 113), fill="#166768")
        draw.rectangle((73, 79, 90, 113), fill="#166768")
        output = io.BytesIO()
        image.save(output, format="PNG")
        uploaded = output.getvalue()
        with (
            patch.object(route, "generate_smart_pattern_variants", side_effect=fake_variants),
            patch.object(route, "download_image", side_effect=lambda _, timeout: uploaded),
            patch.object(route, "DashScopeImageEditClient") as editor_class,
            patch("app.core.mask_processor.create_birefnet_matte", side_effect=AssertionError("当前转换流程不调用 BiRefNet")) as birefnet,
            patch("app.core.pixel_subject.extract_pixel_subject", wraps=extract_pixel_subject) as extract,
        ):
            editor_class.return_value.edit.return_value = ("model-task", "https://example.test/edited.png")
            for mode in ("subject_cartoon", "cartoon_direct"):
                response = self.convert(
                    files={"image": ("person.png", uploaded, "image/png")},
                    data={"mode": mode},
                )
                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertEqual(payload["mask_method"], "demo_pixel_grabcut")
                media = base64.b64decode(payload["transparent_image_url"].split(",", 1)[1])
                with Image.open(io.BytesIO(media)) as subject:
                    self.assertEqual(subject.getpixel((64, 55)), (255, 255, 255, 255))
                    self.assertEqual(subject.getpixel((0, 0))[3], 0)
                    self.assertEqual(subject.getpixel((64, 100))[3], 0)
            birefnet.assert_not_called()
            self.assertEqual(extract.call_count, 2)
            self.assertEqual(editor_class.return_value.edit.call_count, 1)

    def test_real_scene_route_returns_three_independent_artkal_and_mard_boards(self):
        uploaded = image_bytes("#d27a51")
        for brand in ("Artkal", "Mard"):
            response = self.convert(
                files={"image": ("scene.png", uploaded, "image/png")},
                data={"mode": "scene_direct", "brand": brand, "max_colors": "8"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertEqual(payload["brand"], brand)
            self.assertEqual([item["width"] for item in payload["variants"]], [52, 78, 104])
            self.assertEqual(payload["ai_passes"], 0)
            for variant in payload["variants"]:
                size = variant["width"]
                self.assertEqual(len(variant["cells"]), size)
                self.assertTrue(all(len(row) == size for row in variant["cells"]))
                actual = Counter(code for row in variant["cells"] for code in row if code)
                self.assertLessEqual(len(actual), 8)
                self.assertEqual(actual, {item["code"]: item["count"] for item in variant["counts"]})
                self.assertTrue(variant["preview_data_url"].startswith("data:image/png;base64,"))
            first = payload["variants"][0]
            exported = self.client.post("/api/export/png", json={
                "width": first["width"], "height": first["height"], "cells": first["cells"],
                "colors": [{"code": item["code"], "hex": item["hex"], "name": item["name"]} for item in first["counts"]],
            })
            self.assertEqual(exported.status_code, 200, exported.text)
            self.assertTrue(exported.content.startswith(b"\x89PNG"))
            self.assertTrue(payload["raw_image_url"].startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main()
