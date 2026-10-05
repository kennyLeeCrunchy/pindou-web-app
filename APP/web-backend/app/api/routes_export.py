from __future__ import annotations

import io
from collections import Counter

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from PIL import Image

from app.core.exporter import render_pattern_png
from app.core.palette import PaletteColor
from app.core.quantizer import BeadPattern


router = APIRouter(prefix="/api/export", tags=["export"])


class ExportColor(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    hex: str = Field(min_length=4, max_length=9)
    name: str = Field(default="", max_length=100)


class ExportPngRequest(BaseModel):
    pattern_id: str | None = Field(default=None, max_length=64)
    width: int | None = Field(default=None, ge=1, le=200)
    height: int | None = Field(default=None, ge=1, le=200)
    cells: list[list[str | None]] | None = None
    colors: list[ExportColor] | None = None


@router.post("/png")
def export_png(payload: ExportPngRequest) -> Response:
    try:
        pattern = _pattern_from_request(payload)
        png = render_pattern_png(pattern, cell_size=18)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if len(png) > 5 * 1024 * 1024:
        raise HTTPException(413, "导出结果超过传输上限")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="perlabo-edited.png"'},
    )


@router.post("/pdf")
def export_pdf(payload: ExportPngRequest) -> Response:
    try:
        pattern = _pattern_from_request(payload)
        image = Image.open(io.BytesIO(render_pattern_png(pattern, cell_size=18))).convert("RGB")
        output = io.BytesIO()
        image.save(output, format="PDF", resolution=150.0)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if len(output.getvalue()) > 5 * 1024 * 1024:
        raise HTTPException(413, "导出结果超过传输上限")
    return Response(
        content=output.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="perlabo-edited.pdf"'},
    )


def _pattern_from_request(payload: ExportPngRequest) -> BeadPattern:
    if not payload.width or not payload.height or not payload.cells or not payload.colors:
        raise ValueError("width, height, cells, and colors are required for edited pattern export")
    if len(payload.cells) != payload.height or any(len(row) != payload.width for row in payload.cells):
        raise ValueError("Pattern cell dimensions do not match width and height")
    if payload.width > 200 or payload.height > 200:
        raise ValueError("Pattern dimensions cannot exceed 200 x 200")
    if len(payload.colors) > 221:
        raise ValueError("Pattern cannot contain more than 221 colors")

    colors: dict[str, PaletteColor] = {}
    for item in payload.colors:
        if item.code in colors:
            raise ValueError(f"Duplicate color definition: {item.code}")
        value = item.hex.lstrip("#")
        if len(value) != 6:
            raise ValueError(f"Invalid color value for {item.code}")
        rgb = tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))
        colors[item.code] = PaletteColor(
            code=item.code,
            series="M",
            name=item.name,
            name_zh=item.name,
            hex=f"#{value.upper()}",
            rgb=rgb,
        )

    used_codes = [code for row in payload.cells for code in row if code]
    unknown = sorted(set(used_codes) - set(colors))
    if unknown:
        raise ValueError(f"Missing color definitions: {', '.join(unknown)}")
    return BeadPattern(
        width=payload.width,
        height=payload.height,
        cells=payload.cells,
        color_counts=dict(Counter(used_codes)),
        colors={code: colors[code] for code in set(used_codes)},
    )
