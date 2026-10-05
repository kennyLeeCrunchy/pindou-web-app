from __future__ import annotations

import numpy as np
from PIL import Image

from .mask_processor import (
    TransparentForegroundResult,
    create_transparent_foreground,
)


def extract_pixel_subject(image: Image.Image) -> TransparentForegroundResult:
    """Extract a white-background pixel redraw without deleting light props.

    BiRefNet and the generic light-background heuristic are useful for photos,
    but a pixel redraw often contains a white hat or white clothes directly
    against a white canvas. This shared extractor seeds GrabCut from the
    dark/colorful subject pixels and lets the surrounding light regions remain
    probable foreground inside the subject envelope.
    """

    rgba = image.convert("RGBA")
    rgb = np.asarray(rgba.convert("RGB"), dtype=np.uint8)
    height, width = rgb.shape[:2]
    scale = min(1.0, 640.0 / max(height, width))
    if scale < 1.0:
        work_size = (max(32, round(width * scale)), max(32, round(height * scale)))
        work_rgb = np.asarray(
            Image.fromarray(rgb).resize(work_size, Image.Resampling.BILINEAR),
            dtype=np.uint8,
        )
    else:
        work_rgb = rgb

    foreground = _grabcut_pixel_mask(work_rgb)
    if foreground is None:
        return create_transparent_foreground(
            rgba,
            provider="light_background",
            allow_fallback=True,
        )

    if scale < 1.0:
        foreground = np.asarray(
            Image.fromarray(foreground.astype(np.uint8) * 255)
            .resize((width, height), Image.Resampling.NEAREST),
            dtype=np.uint8,
        ) >= 128

    foreground_pixels = int(np.count_nonzero(foreground))
    total_pixels = int(foreground.size)
    ratio = foreground_pixels / total_pixels if total_pixels else 0.0
    if not 0.01 <= ratio <= 0.82:
        return create_transparent_foreground(
            rgba,
            provider="light_background",
            allow_fallback=True,
        )

    output = np.asarray(rgba, dtype=np.uint8).copy()
    output[:, :, 3] = np.where(foreground, 255, 0).astype(np.uint8)
    return TransparentForegroundResult(
        image=Image.fromarray(output, mode="RGBA"),
        method="demo_pixel_grabcut",
        foreground_pixels=foreground_pixels,
        total_pixels=total_pixels,
        success=True,
        reason=None,
    )


def _grabcut_pixel_mask(rgb: np.ndarray) -> np.ndarray | None:
    try:
        import cv2
    except ImportError:
        return None

    height, width = rgb.shape[:2]
    luma = (
        0.299 * rgb[:, :, 0].astype(np.float32)
        + 0.587 * rgb[:, :, 1].astype(np.float32)
        + 0.114 * rgb[:, :, 2].astype(np.float32)
    )
    channel_spread = (
        rgb.max(axis=2).astype(np.int16) - rgb.min(axis=2).astype(np.int16)
    )

    # Pixel redraws normally keep dark hair/outline and a few colored face or
    # clothing blocks. Do not use light pixels as definite foreground: that is
    # exactly how a white hat gets lost.
    dark_or_color_seed = (luma <= 125) | ((channel_spread >= 45) & (luma <= 225))
    # Keep a neutral light outline as a seed as well. Pixel redraws often use
    # pale gray edging for white sleeves or clothes; without this seed, those
    # regions look identical to the white canvas and GrabCut drops them.
    light_outline_seed = (luma <= 245) & (channel_spread <= 35)
    seed = dark_or_color_seed | light_outline_seed
    if int(np.count_nonzero(seed)) < max(24, int(seed.size * 0.002)):
        return None

    ys, xs = np.where(seed)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    subject_width = x1 - x0
    subject_height = y1 - y0
    side_pad = max(8, round(subject_width * 0.24))
    top_pad = max(12, round(subject_height * 0.90))
    bottom_pad = max(8, round(subject_height * 0.40))
    roi_x0 = max(0, x0 - side_pad)
    roi_x1 = min(width, x1 + side_pad)
    roi_y0 = max(0, y0 - top_pad)
    roi_y1 = min(height, y1 + bottom_pad)

    grabcut_mask = np.full((height, width), cv2.GC_BGD, dtype=np.uint8)
    grabcut_mask[roi_y0:roi_y1, roi_x0:roi_x1] = cv2.GC_PR_FGD
    grabcut_mask[seed] = cv2.GC_FGD

    # AI is asked for a safety margin, so a narrow image border is reliable
    # background even when the expanded subject envelope fills the canvas.
    border = max(2, round(min(height, width) * 0.02))
    grabcut_mask[:border, :] = cv2.GC_BGD
    grabcut_mask[-border:, :] = cv2.GC_BGD
    grabcut_mask[:, :border] = cv2.GC_BGD
    grabcut_mask[:, -border:] = cv2.GC_BGD

    background_model = np.zeros((1, 65), dtype=np.float64)
    foreground_model = np.zeros((1, 65), dtype=np.float64)
    try:
        cv2.grabCut(
            rgb,
            grabcut_mask,
            None,
            background_model,
            foreground_model,
            4,
            cv2.GC_INIT_WITH_MASK,
        )
    except cv2.error:
        return None

    foreground = (grabcut_mask == cv2.GC_FGD) | (grabcut_mask == cv2.GC_PR_FGD)
    foreground[:border, :] = False
    foreground[-border:, :] = False
    foreground[:, :border] = False
    foreground[:, -border:] = False
    if not np.any(foreground):
        return None

    # Drop isolated artifacts, while keeping the largest subject component and
    # any substantial component such as a separated hand or prop.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        foreground.astype(np.uint8),
        connectivity=8,
    )
    if count > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        largest = int(np.max(areas))
        keep = np.zeros(count, dtype=bool)
        keep[1:] = (
            (areas == largest)
            | (areas >= max(32, int(largest * 0.025)))
        )
        foreground = keep[labels]

    # AI pixel redraws can leave a one- or two-pixel break in an otherwise
    # closed outline. Close only small gaps before flood-filling the inverse;
    # otherwise white face/clothing areas that are connected to the canvas
    # through that break are incorrectly removed as background.
    gap_radius = max(1, min(3, round(min(height, width) * 0.006)))
    close_kernel = np.ones(
        (gap_radius * 2 + 1, gap_radius * 2 + 1),
        dtype=np.uint8,
    )
    foreground = cv2.morphologyEx(
        foreground.astype(np.uint8),
        cv2.MORPH_CLOSE,
        close_kernel,
    ).astype(bool)

    # A light hat or white shirt can be represented only by its gray pixel
    # outline. Once GrabCut keeps that outline, restore enclosed light pixels
    # instead of treating the enclosed region as canvas background. The small
    # close above makes this work even when the generated outline has a tiny
    # pixel break.
    background = (~foreground).astype(np.uint8)
    flood_mask = np.zeros((height + 2, width + 2), dtype=np.uint8)
    flood_source = background.copy()
    cv2.floodFill(flood_source, flood_mask, (0, 0), 2)
    foreground |= flood_source == 1

    return foreground
