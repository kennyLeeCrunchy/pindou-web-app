"""Numerical color-budget advice; no model calls or semantic face detection."""
from __future__ import annotations

import numpy as np
from PIL import Image

from .perceptual_color import perceptual_pairwise_rgb
from .smart_pattern_f import (
    AUTO_BOARD_SIZES, CandidateTransform, prepare_candidate,
    remove_edge_connected_light_background, _quantize_to_artkal,
    _hue_reserved_codes, _reduce_color_budget,
)

# Demo experiment defaults, not a guarantee of visual quality.
THRESHOLDS = {"p90_delta_e": 6.0, "large_shift_fraction": 0.02, "chroma_boost_fraction": 0.005}


def advise_color_budget(image: Image.Image, palette: list, *, requested: int,
                        is_subject: bool, strategy: str = "ciede2000") -> dict:
    """Pick the smallest evaluated budget meeting numerical limits at all sizes.

    Compare against full-palette mapping at the same grid, isolating loss from
    the color budget. The algorithm never labels a region as skin or a prop.
    """
    from .color_match import rgb_array_to_lab

    rgba = image.convert("RGBA")
    if is_subject:
        rgba = remove_edge_connected_light_background(rgba)
    budgets = sorted({requested, *(n for n in (12, 16, 24, 32, 48, 64) if n >= requested)})
    colors = {c.code: c.rgb for c in palette}
    evaluations = {budget: [] for budget in budgets}
    for width, height in AUTO_BOARD_SIZES:
        prepared = prepare_candidate(rgba, CandidateTransform(width, height, 1.0, 0.0, 0.0))
        full, _ = _quantize_to_artkal(
            prepared.image, palette=palette, width=width, height=height,
            max_colors=len(palette), color_strategy=strategy,
            representative_mode="median", cleanup_mode="none", budget_mode="hue-reserve",
        )
        positions = [(y, x) for y, row in enumerate(full.cells) for x, code in enumerate(row) if code]
        if not positions:
            raise ValueError("没有可转为图纸的可见像素。")
        original = np.array([colors[full.cells[y][x]] for y, x in positions])
        original_lab = rgb_array_to_lab(original)
        original_chroma = np.linalg.norm(original_lab[:, 1:], axis=1)
        reserved = _hue_reserved_codes(full.cells, palette)
        for budget in budgets:
            reduced = _reduce_color_budget(
                full.cells, palette, max_colors=budget, color_strategy=strategy,
                protected_codes=reserved, protected_limit=len(reserved),
            )
            target = np.array([colors[reduced[y][x]] for y, x in positions])
            errors = perceptual_pairwise_rgb(original, target, strategy=strategy)
            target_chroma = np.linalg.norm(rgb_array_to_lab(target)[:, 1:], axis=1)
            p90 = float(np.percentile(errors, 90))
            large = float(np.mean(errors > 12))
            boost = float(np.mean((target_chroma - original_chroma > 12) & (errors > 6)))
            evaluations[budget].append({
                "width": width, "height": height, "p90_delta_e": round(p90, 4),
                "large_shift_fraction": round(large, 6), "chroma_boost_fraction": round(boost, 6),
                "acceptable": p90 <= THRESHOLDS["p90_delta_e"]
                    and large <= THRESHOLDS["large_shift_fraction"]
                    and boost <= THRESHOLDS["chroma_boost_fraction"],
            })
    choices = [{"max_colors": b, "acceptable": all(r["acceptable"] for r in rows), "sizes": rows}
               for b, rows in evaluations.items()]
    selected = next((c["max_colors"] for c in choices if c["acceptable"]), budgets[-1])
    current = choices[0]
    return {
        "requested_max_colors": requested, "recommended_max_colors": selected,
        "current_acceptable": current["acceptable"],
        "recommendation_acceptable": next(c["acceptable"] for c in choices if c["max_colors"] == selected),
        "evaluated": choices, "thresholds": THRESHOLDS.copy(),
        "basis": "local_full_palette_comparison_no_semantic_detection",
        "message": (
            f"当前 {requested} 色的限色变化较小。请对照重绘图检查五官和边缘。"
            if current["acceptable"] else
            f"当前 {requested} 色可能使部分颜色变得明显不同，建议试试 {selected} 色。"
            "如果额头、耳朵出现原图没有的橙色，或脸上出现杂色，可以增加色数再比较。"
        ),
    }
