from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass, replace
from math import inf
from typing import Iterable

import numpy as np
from PIL import Image

from .perceptual_color import (
    ciede2000_distances as _core_ciede2000_distances,
    perceptual_distance_matrix,
    perceptual_pairwise_rgb,
)
from .palette import PaletteColor
from .quantizer import BeadPattern


# Product default and ordered fallbacks.  The order is intentional: do not
# spend extra beads merely to gain a small fidelity-score improvement.
AUTO_BOARD_SIZES = ((52, 52), (78, 78), (104, 104))
# Keep the public/default candidate list aligned with the product strategy.
# The alias remains for compatibility with existing callers.
AUTO_PATTERN_SIZES = AUTO_BOARD_SIZES
# The AI reference is already centered and normalized.  Brute-force scale and
# sub-cell offset search multiplies work without a stable quality benefit.
AUTO_PATTERN_SCALES = (1.0,)
AUTO_PATTERN_OFFSETS = (0.0,)


@dataclass(frozen=True)
class PatternQualityReport:
    score: int
    passed: bool
    feedback: list[str]
    filled_ratio: float
    largest_component_ratio: float
    enclosed_hole_ratio: float
    small_island_ratio: float
    fragmented_color_ratio: float
    border_touch_count: int


@dataclass(frozen=True)
class ColorFidelityReport:
    score: int
    mean_delta_e: float
    p90_delta_e: float
    alpha_iou: float
    feedback: list[str]


@dataclass(frozen=True)
class CandidateTransform:
    width: int
    height: int
    scale: float
    offset_x: float
    offset_y: float


@dataclass(frozen=True)
class SmartPatternResult:
    pattern: BeadPattern
    transform: CandidateTransform
    general_quality: PatternQualityReport
    fidelity_quality: ColorFidelityReport
    overall_score: int
    passed: bool
    candidate_count: int
    recommendation: str


@dataclass(frozen=True)
class _PreparedCandidate:
    image: Image.Image
    original_to_canvas_scale: float
    origin_x: float
    origin_y: float
    cell_size: int


def generate_smart_pattern(
    image: Image.Image,
    *,
    palette: list[PaletteColor],
    max_colors: int,
    sizes: Iterable[tuple[int, int]] = AUTO_PATTERN_SIZES,
    scales: Iterable[float] = AUTO_PATTERN_SCALES,
    offsets: Iterable[float] = AUTO_PATTERN_OFFSETS,
    selection_mode: str = "structure",
    treat_light_background_as_transparent: bool = False,
    color_strategy: str = "ciede2000",
) -> SmartPatternResult:
    rgba = image.convert("RGBA")
    if treat_light_background_as_transparent:
        rgba = remove_edge_connected_light_background(rgba)
    # Keep a wider, source-supported candidate palette while structure is still
    # being evaluated. The user color budget is applied only after grid cleanup.
    candidate_limit = min(len(palette), max(32, max_colors * 2))
    working_palette = _select_working_palette(rgba, palette, candidate_limit, color_strategy)
    size_options = list(sizes)
    transforms = [
        CandidateTransform(width, height, scale, offset_x, offset_y)
        for width, height in size_options
        for scale in scales
        for offset_x in offsets
        for offset_y in offsets
    ]
    if not transforms:
        raise ValueError("智能图纸候选参数为空")

    candidates: list[SmartPatternResult] = []
    prepared_cache: dict[tuple[int, int, float], _PreparedCandidate] = {}
    for transform in transforms:
        cache_key = (transform.width, transform.height, transform.scale)
        base_prepared = prepared_cache.get(cache_key)
        if base_prepared is None:
            base_prepared = prepare_candidate(
                rgba,
                CandidateTransform(
                    transform.width,
                    transform.height,
                    transform.scale,
                    0.0,
                    0.0,
                ),
            )
            prepared_cache[cache_key] = base_prepared
        prepared = _offset_candidate(base_prepared, transform.offset_x, transform.offset_y)
        pattern, _ = _quantize_to_artkal(
            prepared.image,
            palette=working_palette,
            width=transform.width,
            height=transform.height,
            max_colors=max_colors,
            color_strategy=color_strategy,
        )
        general_report = assess_pattern_quality(
            pattern,
            max_colors=max_colors,
            require_transparent_background=treat_light_background_as_transparent,
        )
        fidelity_report = assess_color_fidelity(
            prepared.image,
            pattern,
            color_strategy=color_strategy,
        )
        if selection_mode == "fidelity":
            overall_score = round(general_report.score * 0.25 + fidelity_report.score * 0.75)
            passed = general_report.passed and fidelity_report.score >= 58
        else:
            overall_score = general_report.score
            passed = general_report.passed
        candidates.append(
            SmartPatternResult(
                pattern=pattern,
                transform=transform,
                general_quality=general_report,
                fidelity_quality=fidelity_report,
                overall_score=overall_score,
                passed=passed,
                candidate_count=len(transforms),
                recommendation="",
            )
        )

    if selection_mode == "fidelity":
        ordered_sizes = list(dict.fromkeys(size_options))
        selected = None
        selected_tier = 0
        for tier, (width, height) in enumerate(ordered_sizes):
            passing_at_size = [
                candidate
                for candidate in candidates
                if candidate.passed
                and candidate.transform.width == width
                and candidate.transform.height == height
            ]
            if passing_at_size:
                selected = max(
                    passing_at_size,
                    key=lambda candidate: (
                        candidate.overall_score,
                        candidate.fidelity_quality.score,
                        -abs(candidate.transform.scale - 1.0),
                        -(abs(candidate.transform.offset_x) + abs(candidate.transform.offset_y)),
                    ),
                )
                selected_tier = tier
                break

        # If no board passes the quality gate, the final board is the explicit
        # safety net. Pick its strongest result instead of silently jumping to
        # a large board for a tiny score gain.
        if selected is None:
            fallback_size = ordered_sizes[-1]
            fallback_candidates = [
                candidate
                for candidate in candidates
                if (candidate.transform.width, candidate.transform.height) == fallback_size
            ]
            selected = max(fallback_candidates or candidates, key=lambda candidate: candidate.overall_score)
            selected_tier = len(ordered_sizes) - 1

        tier_text = "默认规格通过质量门禁" if selected_tier == 0 else f"前 {selected_tier} 档未通过质量门禁，自动兜底"
        recommendation = (
            f"推荐 {selected.transform.width}×{selected.transform.height}；"
            f"颜色重建 {selected.fidelity_quality.score}/100，"
            f"{tier_text}。"
        )
        return replace(selected, recommendation=recommendation)

    passing = [candidate for candidate in candidates if candidate.passed]
    if passing:
        selected = min(
            passing,
            key=lambda candidate: (
                candidate.transform.width * candidate.transform.height,
                -candidate.overall_score,
                abs(candidate.transform.scale - 1.0),
                abs(candidate.transform.offset_x) + abs(candidate.transform.offset_y),
            ),
        )
        recommendation = (
            f"推荐 {selected.transform.width}×{selected.transform.height}："
            "这是通过结构门禁的最小候选。"
        )
    else:
        selected = max(
            candidates,
            key=lambda candidate: (
                candidate.overall_score,
                candidate.transform.width * candidate.transform.height,
            ),
        )
        recommendation = (
            "当前主体细节超过候选网格的稳定承载能力，"
            "建议切换 78×78 或 104×104，并人工确认关键特征。"
        )
    return replace(selected, recommendation=recommendation)


def remove_edge_connected_light_background(image: Image.Image) -> Image.Image:
    """Remove only near-white pixels connected to the canvas edge.

    The second model returns a white canvas. Edge connectivity keeps white clothes
    and white props enclosed by the subject while making the canvas transparent.
    """
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    rgb = rgba[:, :, :3].astype(np.int16)
    luma = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    candidate = (luma >= 235) & (spread <= 24) & (rgba[:, :, 3] >= 128)
    height, width = candidate.shape
    background = np.zeros_like(candidate, dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def push(y_pos: int, x_pos: int) -> None:
        if 0 <= y_pos < height and 0 <= x_pos < width and candidate[y_pos, x_pos] and not background[y_pos, x_pos]:
            background[y_pos, x_pos] = True
            queue.append((y_pos, x_pos))

    for x_pos in range(width):
        push(0, x_pos)
        push(height - 1, x_pos)
    for y_pos in range(1, height - 1):
        push(y_pos, 0)
        push(y_pos, width - 1)
    while queue:
        y_pos, x_pos = queue.popleft()
        push(y_pos - 1, x_pos)
        push(y_pos + 1, x_pos)
        push(y_pos, x_pos - 1)
        push(y_pos, x_pos + 1)
    rgba[background, 3] = 0
    return Image.fromarray(rgba, mode="RGBA")


def prepare_candidate(image: Image.Image, transform: CandidateTransform, cell_size: int = 7) -> _PreparedCandidate:
    rgba = image.convert("RGBA")
    visible = rgba.getchannel("A").point(lambda value: 255 if value >= 32 else 0)
    bbox = visible.getbbox()
    if bbox is None:
        raise ValueError("透明主体为空，无法生成图纸候选")
    subject = rgba.crop(bbox)
    canvas_width = transform.width * cell_size
    canvas_height = transform.height * cell_size
    base_scale = min(
        canvas_width * 0.88 / max(1, subject.width),
        canvas_height * 0.88 / max(1, subject.height),
    )
    resize_scale = base_scale * transform.scale
    target_width = max(1, round(subject.width * resize_scale))
    target_height = max(1, round(subject.height * resize_scale))
    resized = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
    left = (canvas_width - target_width) / 2 + transform.offset_x * cell_size
    top = (canvas_height - target_height) / 2 + transform.offset_y * cell_size
    canvas = Image.new("RGBA", (canvas_width, canvas_height), (255, 255, 255, 0))
    canvas.alpha_composite(resized, (round(left), round(top)))
    return _PreparedCandidate(
        image=canvas,
        original_to_canvas_scale=resize_scale,
        origin_x=left - bbox[0] * resize_scale,
        origin_y=top - bbox[1] * resize_scale,
        cell_size=cell_size,
    )


def _offset_candidate(
    prepared: _PreparedCandidate,
    offset_x: float,
    offset_y: float,
) -> _PreparedCandidate:
    if offset_x == 0 and offset_y == 0:
        return prepared
    shift_x = round(offset_x * prepared.cell_size)
    shift_y = round(offset_y * prepared.cell_size)
    shifted = Image.new("RGBA", prepared.image.size, (255, 255, 255, 0))
    shifted.alpha_composite(prepared.image, (shift_x, shift_y))
    return _PreparedCandidate(
        image=shifted,
        original_to_canvas_scale=prepared.original_to_canvas_scale,
        origin_x=prepared.origin_x + shift_x,
        origin_y=prepared.origin_y + shift_y,
        cell_size=prepared.cell_size,
    )


def assess_pattern_quality(
    pattern: BeadPattern,
    *,
    max_colors: int,
    pass_score: int = 72,
    require_transparent_background: bool = True,
) -> PatternQualityReport:
    cells = pattern.cells
    height = pattern.height
    width = pattern.width
    filled = [[cell is not None for cell in row] for row in cells]
    filled_count = sum(sum(row) for row in filled)
    total = max(1, width * height)
    filled_ratio = filled_count / total
    components = _grid_components(filled, target=True)
    component_sizes = sorted((len(component) for component in components), reverse=True)
    largest_component_ratio = component_sizes[0] / filled_count if filled_count else 0.0
    small_island_cells = sum(size for size in component_sizes[1:] if size <= 4)
    small_island_ratio = small_island_cells / filled_count if filled_count else 1.0

    enclosed_hole_cells = 0
    for component in _grid_components(filled, target=False):
        reaches_border = any(
            x_pos in {0, width - 1} or y_pos in {0, height - 1}
            for y_pos, x_pos in component
        )
        if not reaches_border:
            enclosed_hole_cells += len(component)
    enclosed_hole_ratio = enclosed_hole_cells / filled_count if filled_count else 1.0

    fragmented_cells = 0
    for y_pos, row in enumerate(cells):
        for x_pos, code in enumerate(row):
            if code is None:
                continue
            if not any(
                cells[neighbor_y][neighbor_x] == code
                for neighbor_y, neighbor_x in _neighbors(y_pos, x_pos, height, width)
            ):
                fragmented_cells += 1
    fragmented_color_ratio = fragmented_cells / filled_count if filled_count else 1.0
    border_touch_count = sum(filled[0]) + sum(filled[-1]) if filled else 0
    border_touch_count += sum(row[0] + row[-1] for row in filled[1:-1]) if width else 0

    score = 100
    feedback: list[str] = []
    if require_transparent_background and filled_ratio < 0.18:
        score -= min(30, round((0.18 - filled_ratio) * 160))
        feedback.append("主体在图纸中太小")
    elif require_transparent_background and filled_ratio > 0.88:
        score -= min(25, round((filled_ratio - 0.88) * 180))
        feedback.append("主体过满或背景未清除")
    if require_transparent_background and largest_component_ratio < 0.92:
        score -= min(28, round((0.92 - largest_component_ratio) * 80))
        feedback.append("主体存在断裂区域")
    if require_transparent_background and enclosed_hole_ratio > 0.015:
        score -= min(38, 8 + round(enclosed_hole_ratio * 100))
        feedback.append("主体内部出现异常镂空")
    if require_transparent_background and small_island_ratio > 0.01:
        score -= min(18, round(small_island_ratio * 100))
        feedback.append("存在较多孤立拼豆")
    if fragmented_color_ratio > 0.08:
        score -= min(18, round(fragmented_color_ratio * 70))
        feedback.append("单颗碎色过多")
    if require_transparent_background and border_touch_count:
        score -= min(15, 4 + border_touch_count // 2)
        feedback.append("主体触碰图纸边缘")
    color_count = len(pattern.color_counts)
    if color_count < 3:
        score -= 8
        feedback.append("颜色层次过少")
    elif color_count > max_colors:
        score -= min(15, color_count - max_colors)
        feedback.append("工作色超过限制")
    score = max(0, min(100, score))
    severe = filled_count == 0 or (
        require_transparent_background
        and (
            enclosed_hole_ratio > 0.08
            or largest_component_ratio < 0.75
            or filled_ratio < 0.1
            or filled_ratio > 0.95
        )
    )
    return PatternQualityReport(
        score=score,
        passed=score >= pass_score and not severe,
        feedback=feedback[:4],
        filled_ratio=filled_ratio,
        largest_component_ratio=largest_component_ratio,
        enclosed_hole_ratio=enclosed_hole_ratio,
        small_island_ratio=small_island_ratio,
        fragmented_color_ratio=fragmented_color_ratio,
        border_touch_count=border_touch_count,
    )


def assess_color_fidelity(
    prepared_image: Image.Image,
    pattern: BeadPattern,
    *,
    color_strategy: str = "ciede2000",
) -> ColorFidelityReport:
    """Compare a legal Artkal pattern with the continuous-color source it represents."""
    rgba = np.asarray(prepared_image.convert("RGBA"), dtype=np.uint8)
    height_px, width_px = rgba.shape[:2]
    cell_width = width_px // pattern.width
    cell_height = height_px // pattern.height
    if cell_width < 1 or cell_height < 1:
        return ColorFidelityReport(0, 100.0, 100.0, 0.0, ["图纸尺寸超过可评估范围"])

    color_by_code = {code: color.rgb for code, color in pattern.colors.items()}
    grid_rgb = np.zeros((pattern.height, pattern.width, 3), dtype=np.uint8)
    grid_alpha = np.zeros((pattern.height, pattern.width), dtype=np.uint8)
    for y_pos, row in enumerate(pattern.cells):
        for x_pos, code in enumerate(row):
            if code is None:
                continue
            grid_rgb[y_pos, x_pos] = color_by_code[code]
            grid_alpha[y_pos, x_pos] = 255
    reconstructed_rgb = np.repeat(
        np.repeat(grid_rgb, cell_height, axis=0),
        cell_width,
        axis=1,
    )[:height_px, :width_px]
    reconstructed_alpha = np.repeat(
        np.repeat(grid_alpha, cell_height, axis=0),
        cell_width,
        axis=1,
    )[:height_px, :width_px]

    source_mask = rgba[:, :, 3] >= 128
    pattern_mask = reconstructed_alpha >= 128
    union = np.count_nonzero(source_mask | pattern_mask)
    intersection = np.count_nonzero(source_mask & pattern_mask)
    alpha_iou = intersection / union if union else 0.0
    compare_mask = source_mask & pattern_mask
    if not np.any(compare_mask):
        return ColorFidelityReport(0, 100.0, 100.0, alpha_iou, ["主体与图纸没有有效重叠"])

    delta_e = perceptual_pairwise_rgb(
        rgba[:, :, :3][compare_mask].astype(np.float64),
        reconstructed_rgb[compare_mask].astype(np.float64),
        strategy=color_strategy,
    )
    mean_delta_e = float(np.mean(delta_e))
    p90_delta_e = float(np.percentile(delta_e, 90))
    score = round(100 - mean_delta_e * 1.35 - p90_delta_e * 0.22 - (1 - alpha_iou) * 35)
    score = max(0, min(100, score))
    feedback: list[str] = []
    if mean_delta_e > 20:
        feedback.append("整体颜色重建误差较高")
    if p90_delta_e > 35:
        feedback.append("局部颜色失真明显")
    if alpha_iou < 0.88:
        feedback.append("轮廓与原始主体偏差较大")
    return ColorFidelityReport(
        score=score,
        mean_delta_e=round(mean_delta_e, 2),
        p90_delta_e=round(p90_delta_e, 2),
        alpha_iou=float(round(alpha_iou, 4)),
        feedback=feedback,
    )


def _select_working_palette(
    image: Image.Image,
    palette: list[PaletteColor],
    max_colors: int,
    color_strategy: str,
) -> list[PaletteColor]:
    sample = image.resize((96, 96), Image.Resampling.LANCZOS)
    rgba = np.asarray(sample, dtype=np.uint8).reshape(-1, 4)
    visible = rgba[:, 3] >= 64
    rgb = rgba[visible, :3] if np.any(visible) else rgba[:, :3]
    if rgb.size == 0:
        return palette[:max_colors]
    distances = perceptual_distance_matrix(
        rgb.astype(np.float64),
        np.array([color.rgb for color in palette], dtype=np.float64),
        strategy=color_strategy,
    )
    matches = np.argmin(distances, axis=1)
    unique, counts = np.unique(matches, return_counts=True)
    ranked = list(unique[np.argsort(-counts)][:max_colors])
    luma = 0.299 * rgb[:, 0] + 0.587 * rgb[:, 1] + 0.114 * rgb[:, 2]
    if max_colors > 1 and np.any(luma <= 95):
        dark_matches = matches[luma <= 95]
        dark_index = int(np.bincount(dark_matches, minlength=len(palette)).argmax())
        if dark_index not in ranked:
            if len(ranked) >= max_colors:
                ranked[-1] = dark_index
            else:
                ranked.append(dark_index)
    ranked_set = {int(index) for index in ranked}
    return [color for index, color in enumerate(palette) if index in ranked_set]


def ciede2000_distances(source_lab: np.ndarray, palette_lab: np.ndarray) -> np.ndarray:
    """Compatibility export backed by the shared perceptual-color engine."""

    return _core_ciede2000_distances(source_lab, palette_lab)


def _quantize_to_artkal(
    image: Image.Image,
    *,
    palette: list[PaletteColor],
    width: int,
    height: int,
    max_colors: int,
    color_strategy: str,
) -> tuple[BeadPattern, np.ndarray]:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    cell_size = image.width // width
    blocks = rgba.reshape(height, cell_size, width, cell_size, 4)
    blocks = blocks.transpose(0, 2, 1, 3, 4).reshape(height, width, cell_size * cell_size, 4)
    alpha = blocks[:, :, :, 3].astype(np.float64) / 255.0
    visible = alpha >= 0.5
    coverage = np.mean(visible, axis=2)
    rgb = blocks[:, :, :, :3].astype(np.float64)
    # Channel medians are deliberately preferred to averaging. A cell crossing a
    # hard black/skin boundary should retain a real region color instead of
    # inventing a gray-brown fringe.
    masked_rgb = np.ma.array(
        rgb,
        mask=np.broadcast_to(~visible[:, :, :, None], rgb.shape),
    )
    median_rgb = np.ma.median(masked_rgb, axis=2).filled(255.0)
    sample_luma = 0.299 * rgb[:, :, :, 0] + 0.587 * rgb[:, :, :, 1] + 0.114 * rgb[:, :, :, 2]
    dark_samples = visible & (sample_luma <= 100)
    dark_coverage = np.mean(dark_samples, axis=2)
    dark_weights = dark_samples[:, :, :, None].astype(np.float64)
    dark_rgb = np.sum(rgb * dark_weights, axis=2) / np.maximum(np.sum(dark_weights, axis=2), 1e-6)
    local_max = np.max(np.where(visible, sample_luma, -np.inf), axis=2)
    local_min = np.min(np.where(visible, sample_luma, np.inf), axis=2)
    local_luma_range = np.where(coverage > 0, local_max - local_min, 0.0)
    stroke_lock = (dark_coverage >= 0.12) & (local_luma_range >= 42)
    representative = np.where(stroke_lock[:, :, None], dark_rgb, median_rgb)

    distances = perceptual_distance_matrix(
        representative.reshape(-1, 3),
        np.array([color.rgb for color in palette], dtype=np.float64),
        strategy=color_strategy,
    )
    indices = np.argmin(distances, axis=1).reshape(height, width)
    cells: list[list[str | None]] = []
    for y_pos in range(height):
        row: list[str | None] = []
        for x_pos in range(width):
            row.append(palette[int(indices[y_pos, x_pos])].code if coverage[y_pos, x_pos] >= 0.5 else None)
        cells.append(row)
    cells = _cleanup_singletons(cells, representative, palette)
    cells = _cleanup_small_regions(
        cells,
        representative,
        palette,
        dark_coverage,
        color_strategy=color_strategy,
    )
    cells = _reduce_color_budget(
        cells,
        palette,
        max_colors=max_colors,
        color_strategy=color_strategy,
    )
    return _build_pattern(cells, palette), dark_coverage


def _cleanup_singletons(
    cells: list[list[str | None]],
    representative: np.ndarray,
    palette: list[PaletteColor],
) -> list[list[str | None]]:
    output = [row[:] for row in cells]
    height = len(cells)
    width = len(cells[0]) if height else 0
    color_by_code = {color.code: color for color in palette}
    for y_pos, row in enumerate(cells):
        for x_pos, code in enumerate(row):
            if code is None:
                continue
            neighbor_codes = [
                cells[neighbor_y][neighbor_x]
                for neighbor_y, neighbor_x in _neighbors(y_pos, x_pos, height, width)
                if cells[neighbor_y][neighbor_x] is not None
            ]
            if not neighbor_codes or code in neighbor_codes:
                continue
            common_code, common_count = Counter(neighbor_codes).most_common(1)[0]
            if common_count < 2 or common_code is None:
                continue
            current_luma = _luma(color_by_code[code].rgb)
            source_luma = _luma(tuple(representative[y_pos, x_pos]))
            if current_luma <= 115 and source_luma <= 115:
                continue
            output[y_pos][x_pos] = common_code
    return output


def _cleanup_small_regions(
    cells: list[list[str | None]],
    representative: np.ndarray,
    palette: list[PaletteColor],
    dark_coverage: np.ndarray,
    *,
    max_region_size: int = 2,
    color_strategy: str = "ciede2000",
) -> list[list[str | None]]:
    """Merge tiny color islands while preserving supported dark strokes."""

    output = [row[:] for row in cells]
    height = len(cells)
    width = len(cells[0]) if height else 0
    visited: set[tuple[int, int]] = set()
    color_by_code = {color.code: color for color in palette}
    for start_y in range(height):
        for start_x in range(width):
            code = cells[start_y][start_x]
            if code is None or (start_y, start_x) in visited:
                continue
            region: list[tuple[int, int]] = []
            queue = deque([(start_y, start_x)])
            visited.add((start_y, start_x))
            while queue:
                y_pos, x_pos = queue.popleft()
                region.append((y_pos, x_pos))
                for neighbor in _neighbors(y_pos, x_pos, height, width):
                    if neighbor in visited:
                        continue
                    ny, nx = neighbor
                    if cells[ny][nx] == code:
                        visited.add(neighbor)
                        queue.append(neighbor)
            if len(region) > max_region_size:
                continue
            if any(dark_coverage[y_pos, x_pos] >= 0.12 for y_pos, x_pos in region):
                continue
            neighbors = Counter(
                cells[ny][nx]
                for y_pos, x_pos in region
                for ny, nx in _neighbors(y_pos, x_pos, height, width)
                if cells[ny][nx] not in {None, code}
            )
            if not neighbors:
                continue
            replacement, support = neighbors.most_common(1)[0]
            if replacement is None or support < 2:
                continue
            distance = float(
                perceptual_pairwise_rgb(
                    np.array([color_by_code[code].rgb]),
                    np.array([color_by_code[replacement].rgb]),
                    strategy=color_strategy,
                )[0]
            )
            if len(region) == 2 and distance > 12.0:
                continue
            for y_pos, x_pos in region:
                output[y_pos][x_pos] = replacement
    return output


def _reduce_color_budget(
    cells: list[list[str | None]],
    palette: list[PaletteColor],
    *,
    max_colors: int,
    color_strategy: str = "ciede2000",
) -> list[list[str | None]]:
    """Apply the requested material budget after structural cleanup."""

    counts = Counter(code for row in cells for code in row if code is not None)
    if len(counts) <= max_colors:
        return cells
    color_by_code = {color.code: color for color in palette}
    ranked = [code for code, _ in counts.most_common()]
    kept = ranked[:max_colors]

    dark_codes = [code for code in ranked if _luma(color_by_code[code].rgb) <= 95]
    if dark_codes and not any(code in kept for code in dark_codes):
        kept[-1] = dark_codes[0]
    kept = list(dict.fromkeys(kept))
    for code in ranked:
        if len(kept) >= max_colors:
            break
        if code not in kept:
            kept.append(code)

    kept_rgb = np.array([color_by_code[code].rgb for code in kept], dtype=np.float64)
    replacements: dict[str, str] = {}
    for code in ranked:
        if code in kept:
            continue
        replacement_index = int(
            np.argmin(
                perceptual_distance_matrix(
                    np.array([color_by_code[code].rgb], dtype=np.float64),
                    kept_rgb,
                    strategy=color_strategy,
                )[0]
            )
        )
        replacements[code] = kept[replacement_index]
    return [[replacements.get(code, code) if code is not None else None for code in row] for row in cells]


def _build_pattern(cells: list[list[str | None]], palette: list[PaletteColor]) -> BeadPattern:
    counts = Counter(code for row in cells for code in row if code is not None)
    color_map = {color.code: color for color in palette if color.code in counts}
    return BeadPattern(
        width=len(cells[0]) if cells else 0,
        height=len(cells),
        cells=cells,
        color_counts=dict(sorted(counts.items())),
        colors=color_map,
    )


def _neighbors(y_pos: int, x_pos: int, height: int, width: int):
    for neighbor_y, neighbor_x in (
        (y_pos - 1, x_pos),
        (y_pos + 1, x_pos),
        (y_pos, x_pos - 1),
        (y_pos, x_pos + 1),
    ):
        if 0 <= neighbor_y < height and 0 <= neighbor_x < width:
            yield neighbor_y, neighbor_x


def _grid_components(filled: list[list[bool]], *, target: bool) -> list[list[tuple[int, int]]]:
    height = len(filled)
    width = len(filled[0]) if height else 0
    visited: set[tuple[int, int]] = set()
    components: list[list[tuple[int, int]]] = []
    for y_pos in range(height):
        for x_pos in range(width):
            if filled[y_pos][x_pos] != target or (y_pos, x_pos) in visited:
                continue
            component: list[tuple[int, int]] = []
            queue = deque([(y_pos, x_pos)])
            visited.add((y_pos, x_pos))
            while queue:
                current_y, current_x = queue.popleft()
                component.append((current_y, current_x))
                for neighbor in _neighbors(current_y, current_x, height, width):
                    if neighbor in visited:
                        continue
                    neighbor_y, neighbor_x = neighbor
                    if filled[neighbor_y][neighbor_x] == target:
                        visited.add(neighbor)
                        queue.append(neighbor)
            components.append(component)
    return components


def _luma(rgb: tuple[float, float, float] | tuple[int, int, int]) -> float:
    return float(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])
