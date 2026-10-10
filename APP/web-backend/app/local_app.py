"""Trusted local UI and API entry, independent of the deployment entry."""
from __future__ import annotations

import os
import asyncio
import json
import secrets
import sys
from ipaddress import ip_address, ip_network
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles


class LocalApplication:
    def __init__(self, api, frontend_dir: Path, port: int, lan_address: str | None = None,
                 lan_network: str | None = None):
        self.config_path = Path(os.getenv("PINDOU_CONFIG_PATH", Path(__file__).resolve().parents[1] / ".env"))
        self.shutdown = None
        self.api = api
        self.files = StaticFiles(directory=str(frontend_dir), html=True)
        self.hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
        self.lan_url = f"http://{lan_address}:{port}" if lan_address else None
        self.lan_network = None
        if lan_address or lan_network:
            address = ip_address(lan_address or "")
            network = ip_network(lan_network or "", strict=False)
            private_ranges = [ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
            if address.version != 4 or network.version != 4 or address not in network or not any(
                network.subnet_of(private) for private in private_ranges
            ):
                raise ValueError("局域网入口必须使用本机 IPv4 私有地址及其所在网段")
            self.lan_network = network
            self.hosts.add(f"{address}:{port}")
        # The second port is used only by the explicit H5 development command.
        self.origins = {f"http://{host}" for host in self.hosts} | {
            "http://localhost:5181", "http://127.0.0.1:5181",
        }

    def allows_peer(self, peer: str) -> bool:
        if peer in {"127.0.0.1", "::1", "testclient"}:
            return True
        try:
            return self.lan_network is not None and ip_address(peer) in self.lan_network
        except ValueError:
            return False

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.api(scope, receive, send)
            return
        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1").lower()
        origin = headers.get(b"origin", b"").decode("latin-1")
        site = headers.get(b"sec-fetch-site", b"").decode("latin-1")
        peer = (scope.get("client") or ("", 0))[0]
        if (host not in self.hosts or not self.allows_peer(peer)
                or origin and origin not in self.origins or site == "cross-site"):
            await JSONResponse({"detail": "仅允许已配置的本机或局域网访问"}, status_code=403)(scope, receive, send)
            return
        if scope["path"].startswith("/api/"):
            if scope["path"] != "/api/health" and headers.get(b"x-pindou-local") != b"1":
                await JSONResponse({"detail": "请从本地应用页面访问"}, status_code=403)(scope, receive, send)
                return
            if scope["path"] == "/api/local/info" and scope["method"] == "GET":
                await JSONResponse({"lan_url": self.lan_url, "desktop_version": "0.2.0"}, headers={"Cache-Control": "no-store"})(scope, receive, send)
                return
            if scope["path"].startswith("/api/local/"):
                if peer not in {"127.0.0.1", "::1", "testclient"}:
                    await JSONResponse({"detail": "模型配置与退出操作只能在服务器电脑上进行"}, 403)(scope, receive, send)
                    return
                from app.local_settings import public_config, save_config
                status, result = 200, None
                try:
                    if scope["path"] == "/api/local/settings" and scope["method"] == "GET":
                        result = public_config()
                    elif scope["path"] == "/api/local/settings" and scope["method"] == "PUT":
                        body = bytearray()
                        async for chunk in Request(scope, receive).stream():
                            body.extend(chunk)
                            if len(body) > 8192:
                                raise ValueError("配置内容过大")
                        result = save_config(self.config_path, json.loads(body))
                    elif scope["path"] == "/api/local/shutdown" and scope["method"] == "POST" and self.shutdown:
                        result = {"stopped": True}
                        asyncio.get_running_loop().call_later(0.3, self.shutdown)
                    else:
                        status, result = 404, {"detail": "操作不存在"}
                except (ValueError, UnicodeDecodeError):
                    status, result = 400, {"detail": "配置无效，请检查字段与 URL；更换接口或 URL 时须填写对应密钥"}
                except OSError:
                    status, result = 500, {"detail": "无法保存，请将应用解压到可写目录"}
                await JSONResponse(result, status_code=status, headers={"Cache-Control": "no-store"})(scope, receive, send)
                return
            # Never send this secret to the browser. Only accepted trusted requests
            # enter the standard API with the launcher's ephemeral credential.
            scoped = dict(scope)
            scoped["headers"] = [(key, value) for key, value in scope["headers"] if key != b"authorization"]
            scoped["headers"].append((b"authorization", f"Bearer {os.environ['PINDOU_WEB_ACCESS_TOKEN']}".encode()))
            await self.api(scoped, receive, send)
        else:
            try:
                await self.files(scope, receive, send)
            except HTTPException as exc:
                await JSONResponse({"detail": exc.detail}, status_code=exc.status_code)(scope, receive, send)


def create_local_app(frontend_dir: Path | None = None, port: int = 5188,
                     lan_address: str | None = None, lan_network: str | None = None):
    os.environ["PINDOU_WEB_ACCESS_TOKEN"] = secrets.token_urlsafe(48)
    os.environ["PINDOU_QUOTA_BACKEND"] = "local"
    from app.api_main import app
    root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[2]
    directory = frontend_dir or root / "web-frontend" / "dist"
    return LocalApplication(app, directory, port, lan_address, lan_network)
