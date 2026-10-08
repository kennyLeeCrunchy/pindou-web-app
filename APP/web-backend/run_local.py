"""Run the complete local Web app. Model requests still use DashScope."""
from __future__ import annotations

import os
import sys
import argparse
import threading
import time
import webbrowser
from urllib.request import urlopen
from pathlib import Path

import uvicorn
from dotenv import load_dotenv


def open_browser_when_ready(port: int):
    url = f"http://localhost:{port}"
    for _ in range(120):
        try:
            with urlopen(f"{url}/api/health", timeout=1) as response:
                if response.status == 200:
                    webbrowser.open(url)
                    return
        except OSError:
            pass
        time.sleep(0.25)
    print(f"浏览器未自动打开，请手动访问 {url}", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="拼豆本机/可信局域网入口")
    parser.add_argument("--port", type=int, default=5188)
    parser.add_argument("--lan-address")
    parser.add_argument("--lan-network")
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1–65535 之间")
    load_dotenv(Path(__file__).resolve().parent / ".env", override=False)
    from app.local_app import create_local_app
    try:
        application = create_local_app(port=args.port, lan_address=args.lan_address, lan_network=args.lan_network)
    except ValueError as exc:
        parser.error(str(exc))
    except RuntimeError:
        raise SystemExit("浏览器包尚未构建，请在 Web 项目根目录运行 start-local.ps1。")
    configured = bool(os.getenv("DASHSCOPE_API_KEY", "").strip())
    print(f"拼豆本地版：http://localhost:{args.port} （关闭此窗口或 Ctrl+C 停止）", flush=True)
    if args.lan_address:
        print(f"同一局域网访问：http://{args.lan_address}:{args.port}，允许网段 {application.lan_network}", flush=True)
    print("AI 密钥：" + ("已配置，真实生图效果待验证" if configured else "未配置，主体和风景直转仍可使用"), flush=True)
    if args.open_browser:
        threading.Thread(target=open_browser_when_ready, args=(args.port,), daemon=True).start()
    uvicorn.run(application, host="0.0.0.0" if args.lan_address else "127.0.0.1",
                port=args.port, access_log=False, proxy_headers=False)
