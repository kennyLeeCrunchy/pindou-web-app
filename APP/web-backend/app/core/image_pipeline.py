from __future__ import annotations

import base64
import io
import json
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
import urllib.request

import numpy as np
from PIL import Image

from .config import RUNTIME_DIR, get_settings
from .mask_processor import create_transparent_foreground
from .v13_preprocess import EditPrompt, build_v13_edit_prompt


ALGORITHM_VERSION = "bead_ready_52_v2"
PIPELINE_VERSION = "local_classify_single_redraw_three_sizes_v4"


@dataclass(frozen=True)
class SourceAnalysis:
    source_type: str
    prepared_bytes: bytes
    confidence: float
    subject_bytes: bytes | None = None
    mask_method: str | None = None
    foreground_ratio: float | None = None
    reason: str = ""


@dataclass(frozen=True)
class CleanReference:
    clean_reference_id: str
    task_id: str
    model: str
    raw_path: Path
    pattern_source_path: Path
    transparent_path: Path | None
    source_type: str
    confidence: float
    mask_method: str | None
    foreground_ratio: float | None
    prompt_version: str


def build_edit_prompt(
    *,
    mode: str = "auto",
    subject_target: str = "",
    user_prompt: str = "",
) -> EditPrompt:
    """Compatibility entry point for callers using the old APP API names.

    The implementation is now the public copy of the validated v13 prompt
    contract.  ``create_clean_reference`` performs the classification mapping
    before calling this function, so auto mode is retained for compatibility
    but the actual model call receives an explicit v13 branch.
    """

    return build_v13_edit_prompt(
        mode=mode,
        subject_target=subject_target,
        user_prompt=user_prompt,
        source_type="subject" if mode.strip().lower() == "subject" else "scene" if mode.strip().lower() == "scene" else "auto",
    )


def analyze_source_image(
    source_bytes: bytes,
    *,
    mask_provider: str = "birefnet",
    allow_mask_fallback: bool = True,
) -> SourceAnalysis:
    with Image.open(io.BytesIO(source_bytes)) as opened:
        opened.load()
        image = opened.convert("RGBA")

    if _looks_like_existing_artwork(image):
        return SourceAnalysis(
            source_type="cartoon",
            prepared_bytes=_png_bytes(image),
            confidence=0.82,
            reason="低色彩复杂度或已有透明通道，按已有插画保真清理",
        )

    matte = create_transparent_foreground(
        image,
        provider=mask_provider,
        allow_fallback=allow_mask_fallback,
    )
    if matte.success and _is_independent_subject(matte.image, matte.foreground_ratio):
        return _subject_analysis(matte.image, matte.method, matte.foreground_ratio)

    return SourceAnalysis(
        source_type="scene",
        prepared_bytes=_png_bytes(image.convert("RGB")),
        confidence=0.70,
        mask_method=matte.method,
        foreground_ratio=matte.foreground_ratio,
        reason=matte.reason or "未获得可靠独立主体，按完整场景重绘",
    )


def prepare_subject_image(
    source_bytes: bytes,
    *,
    mask_provider: str = "birefnet",
    allow_mask_fallback: bool = True,
) -> SourceAnalysis:
    with Image.open(io.BytesIO(source_bytes)) as opened:
        opened.load()
        image = opened.convert("RGBA")
    matte = create_transparent_foreground(
        image,
        provider=mask_provider,
        allow_fallback=allow_mask_fallback,
    )
    if not matte.success:
        raise ValueError(f"主体提取失败：{matte.reason or '未获得可靠蒙版'}")
    return _subject_analysis(matte.image, matte.method, matte.foreground_ratio, confidence=1.0)


def create_clean_reference(
    *,
    source_bytes: bytes,
    mode: str,
    subject_target: str,
    user_prompt: str,
    output_dir: Path,
) -> CleanReference:
    settings = get_settings()
    normalized_mode = mode.strip().lower() or "auto"
    if normalized_mode == "auto":
        analysis = analyze_source_image(source_bytes)
        prepared_source_bytes = analysis.prepared_bytes
        if analysis.source_type == "subject":
            prompt = build_v13_edit_prompt(
                mode="subject_cartoon",
                subject_presence="yes",
                subject_target=subject_target or "画面中已经提取并置于白底的完整主体",
                user_prompt=user_prompt,
                source_type="subject",
            )
        else:
            prompt = build_v13_edit_prompt(
                mode="whole_image",
                user_prompt=user_prompt,
                source_type=analysis.source_type,
            )
    elif normalized_mode in {"subject", "subject_cartoon"}:
        analysis = prepare_subject_image(source_bytes)
        prepared_source_bytes = analysis.prepared_bytes
        prompt = build_v13_edit_prompt(
            mode="subject_cartoon",
            subject_presence="yes",
            subject_target=subject_target or "画面中已经提取并置于白底的完整主体",
            user_prompt=user_prompt,
            source_type="subject",
        )
    elif normalized_mode in {"scene", "whole_image", "cartoon"}:
        analysis = SourceAnalysis(
            source_type="cartoon" if normalized_mode == "cartoon" else "scene",
            prepared_bytes=source_bytes,
            confidence=1.0,
            reason="用户选择保留整图",
        )
        prepared_source_bytes = source_bytes
        prompt = build_v13_edit_prompt(
            mode="whole_image",
            user_prompt=user_prompt,
            source_type=analysis.source_type,
        )
    else:
        raise ValueError("处理模式只支持 auto、subject 或 scene")

    editor = DashScopeImageEditClient(
        api_key=settings.dashscope_api_key,
        base_url=settings.dashscope_base_url,
        model=settings.dashscope_i2i_model,
    )
    task_id, remote_url = editor.edit(
        normalize_image_as_data_url(prepared_source_bytes),
        prompt.positive,
        negative_prompt=prompt.negative,
        timeout=settings.dashscope_i2i_timeout,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    reference_id = _new_id()
    raw_path = output_dir / f"{reference_id}.clean.raw.png"
    download_image(remote_url, raw_path)

    transparent_path: Path | None = None
    pattern_source_path = raw_path
    mask_method = analysis.mask_method
    foreground_ratio = analysis.foreground_ratio
    if prompt.source_type == "subject" or analysis.source_type == "subject":
        transparent_path = output_dir / f"{reference_id}.clean.transparent.png"
        with Image.open(raw_path) as raw_image:
            matte = create_transparent_foreground(raw_image, provider="birefnet", allow_fallback=True)
        if not matte.success:
            raise ValueError(f"清稿主体提取失败：{matte.reason or 'mask quality gate failed'}")
        matte.image.save(transparent_path, format="PNG")
        pattern_source_path = transparent_path
        mask_method = matte.method
        foreground_ratio = matte.foreground_ratio

    metadata = {
        "clean_reference_id": reference_id,
        "task_id": task_id,
        "model": editor.model,
        "raw_path": raw_path.name,
        "pattern_source_path": pattern_source_path.name,
        "transparent_path": transparent_path.name if transparent_path else None,
        "source_type": prompt.source_type if prompt.source_type != "auto" else analysis.source_type,
        "confidence": analysis.confidence,
        "mask_method": mask_method,
        "foreground_ratio": foreground_ratio,
        "prompt_version": ALGORITHM_VERSION,
        "pipeline": PIPELINE_VERSION,
        "ai_passes": 1,
        "created_at": int(time.time()),
    }
    (output_dir / f"{reference_id}.clean.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return CleanReference(
        clean_reference_id=reference_id,
        task_id=task_id,
        model=editor.model,
        raw_path=raw_path,
        pattern_source_path=pattern_source_path,
        transparent_path=transparent_path,
        source_type=metadata["source_type"],
        confidence=analysis.confidence,
        mask_method=mask_method,
        foreground_ratio=foreground_ratio,
        prompt_version=ALGORITHM_VERSION,
    )


class DashScopeImageEditClient:
    def __init__(self, api_key: str | None, base_url: str, model: str) -> None:
        if not api_key or api_key.strip() in {"", "sk-your-key-here"}:
            raise RuntimeError("DASHSCOPE_API_KEY is not configured")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model

    def edit(
        self,
        image_data_url: str | list[str],
        prompt: str,
        *,
        negative_prompt: str = "",
        timeout: float = 180,
        poll_interval: float = 3,
    ) -> tuple[str, str]:
        task_id = self.create_task(image_data_url, prompt, negative_prompt)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            payload = self.get_task(task_id)
            output = payload.get("output") or {}
            status = output.get("task_status")
            if status == "SUCCEEDED":
                results = output.get("results") or []
                image_url = next((item.get("url") for item in results if item.get("url")), None)
                if not image_url:
                    raise RuntimeError("图生图已完成，但响应中没有图片地址")
                return task_id, image_url
            if status in {"FAILED", "CANCELED", "UNKNOWN"}:
                raise RuntimeError(f"图生图任务失败：{output.get('message') or status}")
            time.sleep(poll_interval)
        raise TimeoutError("图生图等待超时，请稍后重试或跳过清稿")

    def create_task(self, image_data_url: str | list[str], prompt: str, negative_prompt: str) -> str:
        images = [image_data_url] if isinstance(image_data_url, str) else list(image_data_url)
        payload = self._request_json(
            f"{self.base_url}/services/aigc/image2image/image-synthesis",
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
            },
            body=json.dumps({
                "model": self.model,
                "input": {"prompt": prompt, "images": images, "negative_prompt": negative_prompt},
                "parameters": {"prompt_extend": False, "watermark": False, "n": 1},
            }, ensure_ascii=False).encode("utf-8"),
        )
        task_id = (payload.get("output") or {}).get("task_id")
        if not task_id:
            raise RuntimeError(f"DashScope 没有返回图生图 task_id：{payload}")
        return str(task_id)

    def get_task(self, task_id: str) -> dict:
        return self._request_json(
            f"{self.base_url}/tasks/{quote(task_id, safe='')}",
            method="GET",
            headers={"Authorization": f"Bearer {self.api_key}"},
        )

    @staticmethod
    def _request_json(url: str, *, method: str, headers: dict[str, str], body: bytes | None = None) -> dict:
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"DashScope HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"无法连接 DashScope：{exc.reason}") from exc
        if payload.get("code"):
            raise RuntimeError(f"DashScope {payload['code']}: {payload.get('message') or '未知错误'}")
        return payload


def normalize_image_as_data_url(source: bytes) -> str:
    with Image.open(io.BytesIO(source)) as opened:
        image = opened.convert("RGB")
        image.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=95, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def download_image(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "pindou-app/0.3"})
    with urllib.request.urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())
    return destination


def read_clean_reference(reference_id: str) -> dict:
    if not reference_id or not reference_id.isalnum() or len(reference_id) != 32:
        raise ValueError("Invalid clean reference identifier")
    metadata_path = RUNTIME_DIR / "generated" / f"{reference_id}.clean.json"
    if not metadata_path.exists():
        raise ValueError("Clean reference does not exist or has expired")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    source_path = RUNTIME_DIR / "generated" / Path(metadata["pattern_source_path"]).name
    if not source_path.exists():
        raise ValueError("Clean reference image is missing")
    metadata["source_path"] = source_path.name
    return metadata


def _subject_analysis(image: Image.Image, method: str, foreground_ratio: float, *, confidence: float = 0.88) -> SourceAnalysis:
    white = Image.new("RGBA", image.size, (255, 255, 255, 255))
    white.alpha_composite(image)
    return SourceAnalysis(
        source_type="subject",
        prepared_bytes=_png_bytes(white.convert("RGB")),
        subject_bytes=_png_bytes(image),
        confidence=confidence,
        mask_method=method,
        foreground_ratio=foreground_ratio,
        reason="用户选择提取主体" if confidence == 1.0 else "本地主体蒙版通过占比与边缘接触门禁",
    )


def _looks_like_existing_artwork(image: Image.Image) -> bool:
    alpha = np.asarray(image.getchannel("A"), dtype=np.uint8)
    if np.any(alpha < 245):
        return True
    sample = np.asarray(image.convert("RGB").resize((96, 96), Image.Resampling.BILINEAR), dtype=np.uint8)
    return np.unique((sample // 16).reshape(-1, 3), axis=0).shape[0] <= 180


def _is_independent_subject(image: Image.Image, foreground_ratio: float) -> bool:
    if not 0.06 <= foreground_ratio <= 0.74:
        return False
    alpha = np.asarray(image.getchannel("A"), dtype=np.uint8) >= 128
    if not np.any(alpha):
        return False
    border = np.concatenate((alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]))
    ys, xs = np.where(alpha)
    bbox_ratio = ((xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)) / alpha.size
    return float(np.mean(border)) <= 0.28 and bbox_ratio <= 0.86


def _png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _new_id() -> str:
    import uuid

    return uuid.uuid4().hex
