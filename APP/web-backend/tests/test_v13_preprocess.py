import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from app.core.image_pipeline import SourceAnalysis, build_edit_prompt, create_clean_reference
from app.core.v13_preprocess import build_v13_edit_prompt


class V13PreprocessTests(unittest.TestCase):
    def test_public_prompt_module_matches_v13_branches(self):
        auto = build_v13_edit_prompt()
        self.assertEqual((auto.effective_style, auto.source_type), ("auto", "auto"))
        for text in (
            "先在内部判断图片属于哪一类",
            "已有卡通、插画",
            "风景、建筑、室内",
            "真实照片，且有清晰、可独立提取",
            "主体在正方形画面中占约 70%–82%",
            "不要生成像素格",
        ):
            self.assertIn(text, auto.positive)

        subject = build_v13_edit_prompt(
            mode="subject_cartoon",
            subject_presence="yes",
            subject_target="画面中央的人物",
            user_prompt="保留帽子",
            source_type="subject",
        )
        self.assertEqual((subject.effective_style, subject.source_type), ("cartoon", "subject"))
        for text in (
            "适合拼豆降采样的商业角色清稿",
            "最低可读尺度是 52×52",
            "头发归纳为一个清楚的主轮廓",
            "保留帽子",
        ):
            self.assertIn(text, subject.positive)

        whole = build_v13_edit_prompt(mode="whole_image", source_type="scene")
        self.assertEqual((whole.effective_style, whole.source_type), ("preserve", "scene"))
        self.assertIn("不提取主体", whole.positive)

    def test_legacy_app_prompt_entry_delegates_to_v13_contract(self):
        prompt = build_edit_prompt(mode="subject", subject_target="主体")
        self.assertEqual(prompt.source_type, "subject")
        self.assertIn("最低可读尺度是 52×52", prompt.positive)

    def test_auto_subject_runs_preparation_edit_and_post_edit_extraction(self):
        source = io.BytesIO()
        Image.new("RGB", (32, 32), "white").save(source, format="PNG")
        subject = Image.new("RGBA", (32, 32), (200, 80, 40, 255))
        prepared = io.BytesIO()
        Image.new("RGB", (32, 32), "white").save(prepared, format="PNG")
        analysis = SourceAnalysis(
            source_type="subject",
            prepared_bytes=prepared.getvalue(),
            confidence=0.88,
            subject_bytes=None,
            mask_method="birefnet_lite_matting",
            foreground_ratio=0.4,
        )
        matte = SimpleNamespace(
            image=subject,
            method="birefnet_lite_matting",
            foreground_ratio=0.4,
            success=True,
            reason=None,
        )

        with (
            tempfile.TemporaryDirectory() as directory,
            patch("app.core.image_pipeline.analyze_source_image", return_value=analysis) as analyze,
            patch("app.core.image_pipeline.create_transparent_foreground", return_value=matte) as extract,
            patch(
                "app.core.image_pipeline.get_settings",
                return_value=SimpleNamespace(
                    dashscope_api_key="test-key",
                    dashscope_base_url="https://example.test/api/v1",
                    dashscope_i2i_model="wan2.5-i2i-preview",
                    dashscope_i2i_timeout=180,
                ),
            ),
            patch("app.core.image_pipeline.DashScopeImageEditClient") as editor_class,
            patch("app.core.image_pipeline.download_image") as download,
        ):
            editor_class.return_value.model = "wan2.5-i2i-preview"
            editor_class.return_value.edit.return_value = ("task-clean", "https://example.test/clean.png")

            def save_download(_url: str, destination: Path) -> Path:
                Image.new("RGB", (32, 32), "white").save(destination, format="PNG")
                return destination

            download.side_effect = save_download
            result = create_clean_reference(
                source_bytes=source.getvalue(),
                mode="auto",
                subject_target="",
                user_prompt="保留帽子",
                output_dir=Path(directory),
            )

        analyze.assert_called_once()
        editor_class.return_value.edit.assert_called_once()
        extract.assert_called_once()
        edit_prompt = editor_class.return_value.edit.call_args.args[1]
        self.assertIn("最低可读尺度是 52×52", edit_prompt)
        self.assertIn("保留帽子", edit_prompt)
        self.assertEqual(result.prompt_version, "bead_ready_52_v2")
        self.assertEqual(result.source_type, "subject")
        self.assertIsNotNone(result.transparent_path)


if __name__ == "__main__":
    unittest.main()
