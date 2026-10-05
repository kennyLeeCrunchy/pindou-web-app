from __future__ import annotations

import base64
import json
from pathlib import Path
from uuid import uuid4

from PIL import Image

from .config import RUNTIME_DIR
from .exporter import render_pattern_png
from .image_pipeline import ALGORITHM_VERSION, PIPELINE_VERSION
from .mask_processor import create_transparent_foreground
from .palette import PaletteColor
from .quality import report_to_dict
from .smart_pattern import AUTO_BOARD_SIZES, generate_smart_pattern
from .schemas import pattern_counts_for_ui, pattern_to_dict


def generate_pattern_bundle(
    image: Image.Image,
    *,
    palette: list[PaletteColor],
    max_colors: int = 20,
    use_transparent_mask: bool = False,
    clean_reference_id: str | None = None,
) -> dict:
    working_image = prepare_pattern_source(image, use_transparent_mask=use_transparent_mask)

    effective_max_colors = max_colors if max_colors > 0 else len(palette)
    variants: list[dict] = []
    for width, height in AUTO_BOARD_SIZES:
        smart = generate_smart_pattern(
            working_image,
            palette=palette,
            max_colors=effective_max_colors,
            sizes=[(width, height)],
            scales=(1.0,),
            offsets=(0.0,),
            selection_mode="fidelity",
            treat_light_background_as_transparent=use_transparent_mask,
            color_strategy="ciede2000",
        )
        pattern = smart.pattern
        pattern_id = uuid4().hex
        path = RUNTIME_DIR / "generated" / f"{pattern_id}.json"
        path.write_text(json.dumps(pattern_to_dict(pattern), ensure_ascii=False), encoding="utf-8")
        preview = render_pattern_png(pattern, cell_size=8 if width >= 78 else 10)
        variants.append({
            "pattern_id": pattern_id,
            "width": width,
            "height": height,
            "cells": pattern.cells,
            "counts": pattern_counts_for_ui(pattern),
            "preview_data_url": "data:image/png;base64," + base64.b64encode(preview).decode("ascii"),
            "quality": {
                "structure": report_to_dict(smart.general_quality),
                "color": report_to_dict(smart.fidelity_quality),
            },
            "passed": smart.passed,
            "overall_score": smart.overall_score,
            "recommendation": smart.recommendation,
        })
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "pipeline": PIPELINE_VERSION,
        "ai_passes": 1 if clean_reference_id else 0,
        "clean_reference_id": clean_reference_id,
        "variants": variants,
    }


def prepare_pattern_source(image: Image.Image, *, use_transparent_mask: bool) -> Image.Image:
    """Prepare the exact source used by both single and bundled web routes."""

    if not use_transparent_mask:
        return image
    if "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 250:
        return image.convert("RGBA")
    matte = create_transparent_foreground(
        image,
        provider="birefnet",
        allow_fallback=True,
    )
    if not matte.success:
        raise ValueError(
            f"透明底处理失败：{matte.reason or 'mask quality gate failed'}。"
            "请使用清晰单主体图片，或关闭透明底模式。"
        )
    return matte.image
