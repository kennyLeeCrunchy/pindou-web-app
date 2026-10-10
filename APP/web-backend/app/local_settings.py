"""Loopback-only configuration; saved secrets are never returned to the browser."""
import os
import re
import tempfile
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit
from dotenv import set_key, dotenv_values

_lock = RLock()
_FIELDS = {"provider": "PINDOU_AI_PROVIDER", "protocol": "PINDOU_AI_PROTOCOL",
           "model": "PINDOU_WEB_I2I_MODEL", "base_url": "DASHSCOPE_BASE_URL", "api_key": "DASHSCOPE_API_KEY"}

def load_saved_model(path):
    with _lock:
        saved = dotenv_values(path)
        os.environ.update({name: saved[name] for name in _FIELDS.values() if saved.get(name) is not None})


def model_config():
    with _lock:
        return dict(provider=os.getenv("PINDOU_AI_PROVIDER", "阿里云百炼"),
                    protocol=os.getenv("PINDOU_AI_PROTOCOL", "dashscope"),
                    model=os.getenv("PINDOU_WEB_I2I_MODEL", "qwen-image-3.0-pro"),
                    base_url=os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/api/v1"),
                    api_key=os.getenv("DASHSCOPE_API_KEY", ""))

def public_config():
    config = model_config()
    config["key_configured"] = bool(config.pop("api_key"))
    return config

def save_config(path: Path, value):
    if not isinstance(value, dict) or set(value) != set(_FIELDS):
        raise ValueError("配置字段不完整")
    if not all(isinstance(item, str) for item in value.values()):
        raise ValueError("配置必须为文本")
    config = {name: item.strip() for name, item in value.items()}
    if config["protocol"] not in {"dashscope", "openai"}:
        raise ValueError("请选择支持的图片编辑接口")
    if not config["provider"] or len(config["provider"]) > 80 or any(ord(c) < 32 for c in config["provider"]):
        raise ValueError("供应商名称须为 1–80 个字符")
    if not re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", config["model"]):
        raise ValueError("模型名称格式无效")
    try:
        parsed = urlsplit(config["base_url"])
        port = parsed.port
        valid = (len(config["base_url"]) <= 2048 and parsed.hostname and not parsed.username
                 and not parsed.password and not parsed.query and not parsed.fragment
                 and (parsed.scheme == "https" or parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"})
                 and all(32 < ord(c) < 127 for c in config["base_url"]))
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("URL 须为 HTTPS API 基础地址（本机接口允许 HTTP），不能包含凭据、查询或片段")
    config["base_url"] = config["base_url"].rstrip("/")
    if config["api_key"] and not re.fullmatch(r"[!-~]{8,4096}", config["api_key"]):
        raise ValueError("密钥须为 8–4096 个可打印 ASCII 字符")
    with _lock:
        old = model_config()
        if not config["api_key"]:
            if old["api_key"] and (config["base_url"] != old["base_url"].rstrip("/") or config["protocol"] != old["protocol"]):
                raise ValueError("更换 URL 或接口时，请重新填写对应供应商的密钥")
            config["api_key"] = old["api_key"]
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                if path.exists():
                    handle.write(path.read_text(encoding="utf-8"))
            for name, env_name in _FIELDS.items():
                set_key(temporary, env_name, config[name])
            os.replace(temporary, path)
            os.environ.update({_FIELDS[name]: item for name, item in config.items()})
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
    return public_config()
