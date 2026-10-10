"""The OpenAI-compatible multipart image-edit protocol, without new dependencies."""
import base64
import json
import httpx

MAX_IMAGE_BYTES = 12 * 1024 * 1024

class OpenAIImageEditClient:
    def __init__(self, api_key, base_url, model):
        self.api_key, self.base_url, self.model = api_key, base_url.rstrip("/"), model

    def edit(self, image_data_url, prompt, *, negative_prompt="", timeout=50):
        image = base64.b64decode(image_data_url.split(",", 1)[1], validate=True)
        fields = {"model": self.model, "prompt": prompt + ("\n避免：" + negative_prompt if negative_prompt else ""), "n": "1", "size": "1024x1024"}
        if not self.model.startswith("gpt-image"):
            fields["response_format"] = "b64_json"
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            with client.stream("POST", self.base_url + "/images/edits", headers={"Authorization": "Bearer " + self.api_key},
                               data=fields, files={"image": ("image.png", image, "image/png")}) as response:
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 17 * 1024 * 1024:
                        raise ValueError("模型响应超过大小上限")
        result = json.loads(body)
        item = (result.get("data") or [{}])[0]
        if item.get("b64_json"):
            output = base64.b64decode(item["b64_json"], validate=True)
            if not output or len(output) > MAX_IMAGE_BYTES:
                raise ValueError("模型图片超过大小上限")
            return "openai-image", output
        if item.get("url"):
            return "openai-image", str(item["url"])
        raise RuntimeError("图片编辑接口没有返回图片")
