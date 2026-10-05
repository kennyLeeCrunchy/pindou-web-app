from __future__ import annotations

import json
import time
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import quote


class DashScopeImageEditClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str = "qwen-image-3.0-pro",
        output_size: str = "1024*1024",
    ) -> None:
        if not api_key or api_key.startswith("你的"):
            raise RuntimeError("请先设置有效的 DASHSCOPE_API_KEY。")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.output_size = output_size

    def edit(
        self,
        image_data_url: str | list[str],
        prompt: str,
        *,
        negative_prompt: str = "",
        poll_interval: float = 3,
        timeout: float = 180,
    ) -> tuple[str, str]:
        if self._uses_multimodal_api:
            return self._edit_multimodal(
                image_data_url=image_data_url,
                prompt=prompt,
                negative_prompt=negative_prompt,
                timeout=timeout,
            )

        task_id = self.create_task(
            image_data_url=image_data_url,
            prompt=prompt,
            negative_prompt=negative_prompt,
        )
        deadline = time.monotonic() + timeout

        while time.monotonic() < deadline:
            payload = self.get_task(task_id)
            output = payload.get("output") or {}
            status = output.get("task_status")
            if status == "SUCCEEDED":
                results = output.get("results") or []
                image_url = next((item.get("url") for item in results if item.get("url")), None)
                if not image_url:
                    raise RuntimeError("任务已完成，但响应中没有生成图片。")
                return task_id, image_url
            if status in {"FAILED", "CANCELED", "UNKNOWN"}:
                detail = output.get("message") or payload.get("message") or status
                raise RuntimeError(f"图生图任务失败：{detail}")
            time.sleep(poll_interval)

        raise TimeoutError("图生图等待超时，请稍后重试或增大 PINDOU_I2I_TIMEOUT。")

    @property
    def _uses_multimodal_api(self) -> bool:
        return self.model.startswith(("qwen-image", "wan2.6-image", "wan2.7-image"))

    def _edit_multimodal(
        self,
        image_data_url: str | list[str],
        prompt: str,
        negative_prompt: str,
        timeout: float,
    ) -> tuple[str, str]:
        images = [image_data_url] if isinstance(image_data_url, str) else list(image_data_url)
        max_images = 9 if self.model.startswith("wan2.7-image") else 3
        if not 1 <= len(images) <= max_images:
            raise ValueError(f"{self.model} 只支持 1–{max_images} 张参考图。")

        content = [{"image": image} for image in images]
        content.append({"text": prompt})
        parameters: dict[str, object] = {"watermark": False, "n": 1}
        if self.output_size:
            parameters["size"] = self.output_size
        if self.model.startswith("qwen-image"):
            parameters["prompt_extend"] = False
            if negative_prompt:
                parameters["negative_prompt"] = negative_prompt

        payload = self._request_json(
            f"{self.base_url}/services/aigc/multimodal-generation/generation",
            method="POST",
            headers={
                **self._headers(),
                "Content-Type": "application/json",
            },
            body=json.dumps(
                {
                    "model": self.model,
                    "input": {"messages": [{"role": "user", "content": content}]},
                    "parameters": parameters,
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            timeout=timeout,
        )
        self._raise_api_error(payload)
        choices = (payload.get("output") or {}).get("choices") or []
        message = (choices[0] if choices else {}).get("message") or {}
        message_content = message.get("content") or []
        image_url = next(
            (item.get("image") for item in message_content if isinstance(item, dict) and item.get("image")),
            None,
        )
        if not image_url:
            raise RuntimeError("DashScope 已响应，但没有返回生成图片地址。")
        task_id = str(payload.get("request_id") or "dashscope-image")
        return task_id, str(image_url)

    def create_task(self, image_data_url: str | list[str], prompt: str, negative_prompt: str = "") -> str:
        images = [image_data_url] if isinstance(image_data_url, str) else list(image_data_url)
        if not 1 <= len(images) <= 3:
            raise ValueError("万相图像编辑只支持 1–3 张参考图。")
        payload = self._request_json(
            f"{self.base_url}/services/aigc/image2image/image-synthesis",
            method="POST",
            headers={
                **self._headers(),
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
            },
            body=json.dumps(
                {
                    "model": self.model,
                    "input": {
                        "prompt": prompt,
                        "images": images,
                        "negative_prompt": negative_prompt,
                    },
                    "parameters": {
                        "prompt_extend": False,
                        "watermark": False,
                        "n": 1,
                    },
                },
                ensure_ascii=False,
            ).encode("utf-8"),
        )
        self._raise_api_error(payload)
        task_id = (payload.get("output") or {}).get("task_id")
        if not task_id:
            raise RuntimeError("DashScope 没有返回 task_id。")
        return str(task_id)

    def get_task(self, task_id: str) -> dict:
        payload = self._request_json(
            f"{self.base_url}/tasks/{quote(task_id, safe='')}",
            method="GET",
            headers=self._headers(),
        )
        self._raise_api_error(payload)
        return payload

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    @staticmethod
    def _raise_api_error(payload: dict) -> None:
        code = payload.get("code")
        if code:
            message = payload.get("message") or "未知错误"
            raise RuntimeError(f"DashScope {code}: {message}")

    @staticmethod
    def _request_json(
        url: str,
        *,
        method: str,
        headers: dict[str, str],
        body: bytes | None = None,
        timeout: float = 60,
    ) -> dict:
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"DashScope HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"无法连接 DashScope：{exc.reason}") from exc
