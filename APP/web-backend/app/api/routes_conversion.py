from __future__ import annotations

import base64
import io
import multiprocessing
import os
import re
import time
from threading import Lock
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from app.api.routes_auth import check_rate_limit, require_session
from app.core.config import DATA_DIR, MARD_PALETTE_PATH, get_settings
from app.core.color_budget import advise_color_budget
from app.core.exporter import render_pattern_png
from app.core.image_pipeline import normalize_image_as_data_url, prepare_subject_image
from app.core.image_edit_client import DashScopeImageEditClient
from app.core.image_edit_prompts import build_xhs_edit_prompt
from app.core.palette import load_mard_palette, load_palette, load_presets, resolve_palette
from app.core.schemas import pattern_counts_for_ui
from app.core.smart_pattern_f import AUTO_BOARD_SIZES, generate_smart_pattern_variants

router = APIRouter(tags=["conversion"])
# Stay below the HTTP function's 6 MB request/response envelope.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
ALGORITHM_VERSION = "manual_route_median_f_grabcut_ephemeral_v14_two_step_auto_no_references"
_conversion_lock = Lock()


def _open_image(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as opened:
        if opened.format not in {"JPEG", "PNG", "WEBP"} or opened.width * opened.height > MAX_IMAGE_PIXELS:
            raise ValueError("只支持 JPG、PNG、WebP，图片不得超过 1200 万像素")
        opened.load()
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    image.thumbnail((1536, 1536))
    return image


def _png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _data_url(image: Image.Image) -> str:
    preview = image.copy()
    preview.thumbnail((512, 512))
    return "data:image/png;base64," + base64.b64encode(_png_bytes(preview)).decode("ascii")


def _palette(brand: str, preset: str) -> list:
    if brand == "Mard" and preset == "221":
        return list(load_mard_palette(MARD_PALETTE_PATH).values())
    if brand == "Artkal" and preset == "221":
        return resolve_palette(load_palette(DATA_DIR / "artkal_m_series.json"), load_presets(DATA_DIR / "artkal_presets.json"), preset)
    raise ValueError("只支持 Artkal 或 Mard 的完整 221 色卡")


def download_image(url: str, timeout: float) -> bytes:
    from urllib.parse import urlsplit
    parsed = urlsplit(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in {None, 443} or not hostname.endswith((".aliyuncs.com", ".aliyun.com")):
        raise ValueError("模型返回了不支持的图片地址")
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            output = bytearray()
            for chunk in response.iter_bytes():
                output.extend(chunk)
                if len(output) > 12 * 1024 * 1024:
                    raise ValueError("模型图片超过大小上限")
            return bytes(output)


def _build_result(source_bytes: bytes, options: dict, deadline: float) -> dict:
    def remaining(reserve: float = 0) -> float:
        value = deadline - time.monotonic() - reserve
        if value <= 0:
            raise TimeoutError("请求处理超时")
        return value

    remaining()
    mode, framing_mode = options["mode"], options["framing_mode"]
    source = _open_image(source_bytes)
    palette = _palette(options["brand"], options["preset"])
    source_bytes = _png_bytes(source)
    ai_image = None
    pattern_bytes = source_bytes
    mask_method = None
    model_input_image_count = 0
    if mode == "subject_cartoon":
        edit_prompt = build_xhs_edit_prompt(mode=mode, subject_presence="yes", subject_target=options["subject_target"], user_prompt=options["prompt"], framing_mode=framing_mode)
        prompt_text = edit_prompt.positive
        model_inputs = normalize_image_as_data_url(source_bytes)
        model_input_image_count = 1
        settings = get_settings()
        editor = DashScopeImageEditClient(api_key=settings.dashscope_api_key or "", base_url=settings.dashscope_base_url, model=os.getenv("PINDOU_WEB_I2I_MODEL", "qwen-image-3.0-pro"), output_size="1024*1024")
        remaining()
        _, remote_url = editor.edit(model_inputs, prompt_text, negative_prompt=edit_prompt.negative, timeout=min(settings.dashscope_i2i_timeout, remaining(15)))
        pattern_bytes = download_image(remote_url, timeout=min(8, remaining(8)))
        ai_image = _open_image(pattern_bytes)
        pattern_bytes = _png_bytes(ai_image)
    if mode != "scene_direct":
        remaining()
        extracted = prepare_subject_image(pattern_bytes, mask_provider="pixel_grabcut")
        if extracted.subject_bytes is None:
            raise ValueError("主体提取失败，请使用背景干净的单主体图片")
        pattern_bytes, mask_method = extracted.subject_bytes, extracted.mask_method
    pattern_source = _open_image(pattern_bytes)
    remaining()
    if options.get("operation") == "prepare":
        prepared_bytes = _png_bytes(pattern_source)
        if len(prepared_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "准备后的图片超过 4MB，请缩小原图后重试")
        return {
            "task_id": uuid4().hex, "phase": "prepared", "mode": mode,
            "framing_mode": framing_mode if mode == "subject_cartoon" else None,
            "ai_passes": int(mode == "subject_cartoon"), "algorithm_version": ALGORITHM_VERSION,
            "mask_method": mask_method, "raw_image_url": _data_url(source),
            "ai_image_url": _data_url(ai_image) if ai_image else None,
            "transparent_image_url": _data_url(pattern_source) if mode != "scene_direct" else None,
            "prepared_image_url": "data:image/png;base64," + base64.b64encode(prepared_bytes).decode("ascii"),
            "style_reference_urls": [], "style_reference_color_mode": None,
            "model_input_image_count": model_input_image_count,
        }
    color_selection = options.get("color_selection", "manual")
    color_advice = advise_color_budget(pattern_source, palette, requested=options["colors"], is_subject=mode != "scene_direct", strategy="ciede2000")
    selected_colors = color_advice["recommended_max_colors"] if color_selection == "auto" else options["colors"]
    remaining()
    results = generate_smart_pattern_variants(pattern_source, palette=palette, max_colors=selected_colors, sizes=AUTO_BOARD_SIZES, scales=(1.0,), offsets=(0.0,), selection_mode="fidelity", treat_light_background_as_transparent=mode != "scene_direct", color_strategy="ciede2000")
    variants = []
    for result in results:
        remaining()
        pattern = result.pattern
        preview = render_pattern_png(pattern, cell_size=max(6, min(16, 768 // pattern.width)))
        variants.append({"width": pattern.width, "height": pattern.height, "cells": pattern.cells, "counts": pattern_counts_for_ui(pattern), "preview_data_url": "data:image/png;base64," + base64.b64encode(preview).decode("ascii"), "quality": {"overall_score": result.overall_score, "passed": result.passed, "recommendation": result.recommendation}})
    remaining()
    return {
        "task_id": uuid4().hex, "mode": mode, "framing_mode": framing_mode if mode == "subject_cartoon" else None,
        "brand": options["brand"], "preset": options["preset"], "max_colors": selected_colors, "ai_passes": int(mode == "subject_cartoon"),
        "color_selection": color_selection, "color_advice": color_advice,
        "algorithm_version": ALGORITHM_VERSION, "pipeline": ALGORITHM_VERSION, "mask_method": mask_method,
        "raw_image_url": _data_url(source), "ai_image_url": _data_url(ai_image) if ai_image else None,
        "transparent_image_url": _data_url(pattern_source) if mode != "scene_direct" else None,
        "style_reference_urls": [], "style_reference_color_mode": None,
        "model_input_image_count": model_input_image_count, "variants": variants,
    }


def _worker(connection, source_bytes: bytes, options: dict, deadline: float) -> None:
    try:
        connection.send((200, _build_result(source_bytes, options, deadline)))
    except HTTPException as exc:
        connection.send((exc.status_code, exc.detail))
    except (ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        connection.send((400, "图片处理失败，请检查图片格式、尺寸和主体背景"))
    except (TimeoutError, httpx.TimeoutException):
        connection.send((504, "图片处理超时，请稍后重试"))
    except Exception:
        connection.send((502, "图片服务暂不可用，请稍后重试"))
    finally:
        connection.close()


def _run_conversion(source_bytes: bytes, options: dict, deadline: float) -> dict:
    # ponytail: one short-lived worker per conversion; hard deadline kills CPU or
    # stalled network work. Use a job queue only if measured concurrency needs it.
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=_worker, args=(send, source_bytes, options, deadline))
    try:
        process.start()
        send.close()
        if not receive.poll(max(0, deadline - time.monotonic())):
            raise HTTPException(504, "图片处理超时，请勿重复提交同一请求")
        try:
            status, result = receive.recv()
        except EOFError as exc:
            raise HTTPException(502, "图片处理失败，请稍后重试") from exc
        if status != 200:
            raise HTTPException(status, result)
        return result
    finally:
        if process.pid:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join()
        receive.close()
        send.close()


@router.post("/api/pattern/prepare")
@router.post("/api/pattern/convert")
async def convert_pattern(request: Request, image: UploadFile = File(...), mode: str = Form(...), request_id: str = Form(...), framing_mode: str = Form("flat"), subject_target: str = Form(""), prompt: str = Form(""), brand: str = Form("Artkal"), preset: str = Form("221"), max_colors: int | None = Form(None), color_selection: str | None = Form(None)) -> Response:
    started = getattr(request.state, "started", time.monotonic())
    deadline = started + 85
    acquired = False
    try:
        user_id = require_session(request)
        if mode not in {"cartoon_direct", "scene_direct", "subject_cartoon"} or framing_mode not in {"flat", "pendant"} or (mode != "subject_cartoon" and framing_mode != "flat"):
            raise HTTPException(400, "处理路线或取景模式无效")
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", request_id) or len(subject_target) > 300 or len(prompt) > 2000:
            raise HTTPException(400, "请求标识或描述无效")
        colors = max_colors if max_colors is not None else (24 if mode == "scene_direct" else 12)
        if not 4 <= colors <= 64 or brand not in {"Artkal", "Mard"} or preset != "221":
            raise HTTPException(400, "色数或色卡无效")
        # Existing clients with an explicit max_colors retain their hard budget.
        selection = color_selection if color_selection is not None else ("manual" if max_colors is not None else "auto")
        if selection not in {"auto", "manual"}:
            raise HTTPException(400, "选色方式无效")
        if not image.filename or Path(image.filename).suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            raise HTTPException(400, "只支持 JPG、PNG、WebP 图片")
        source_bytes = await image.read(MAX_UPLOAD_BYTES + 1)
        if not source_bytes or len(source_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "图片为空或超过 4MB，请压缩后上传")
        acquired = _conversion_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(429, "服务正在处理其他图片，请稍后重试")
        if mode == "subject_cartoon":
            # Validate before reserving an AI attempt. Quota belongs to the parent
            # process: a spawned worker has no persistent local quota state.
            try:
                _open_image(source_bytes)
            except (ValueError, UnidentifiedImageError, Image.DecompressionBombError):
                raise HTTPException(400, "图片处理失败，请检查图片格式和尺寸")
            if not get_settings().dashscope_api_key:
                raise HTTPException(503, "服务端模型配置缺失")
            await run_in_threadpool(check_rate_limit, user_id, request_id)
        options = dict(user_id=user_id, request_id=request_id, mode=mode, framing_mode=framing_mode, subject_target=subject_target, prompt=prompt, brand=brand, preset=preset, colors=colors, color_selection=selection, operation="prepare" if request.url.path == "/api/pattern/prepare" else "convert")
        result = await run_in_threadpool(_run_conversion, source_bytes, options, deadline)
        response = JSONResponse(result)
        if len(response.body) > MAX_RESPONSE_BYTES:
            raise HTTPException(413, "结果超过传输上限，请换用更简单的图片")
        return response
    finally:
        if acquired:
            _conversion_lock.release()
        await image.close()
