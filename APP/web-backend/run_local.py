"""Run the complete local Web app. Image edits use the configured provider."""
from __future__ import annotations

import os
import json
import socket
import subprocess
import sys
import argparse
import multiprocessing
import threading
import time
import webbrowser
from urllib.request import urlopen, Request
from pathlib import Path

import uvicorn
from dotenv import load_dotenv


def open_browser_when_ready(port: int, configure: bool = False):
    url = f"http://localhost:{port}"
    for _ in range(120):
        try:
            with urlopen(f"{url}/api/health", timeout=1) as response:
                if response.status == 200 and json.load(response).get("service") == "perlabo-web":
                    webbrowser.open(url + ("/#/pages/settings/index" if configure else ""))
                    return
        except OSError:
            pass
        time.sleep(0.25)
    print(f"浏览器未自动打开，请手动访问 {url}", flush=True)


def detect_lan():
    if os.name != "nt":
        return None
    command = "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.NetAdapter.HardwareInterface } | Sort-Object { $_.NetIPv4Interface.InterfaceMetric } | ForEach-Object { Get-NetIPAddress -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' } | Select-Object IPAddress,PrefixLength } | ConvertTo-Json -Compress"
    try:
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                                capture_output=True, text=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
        addresses = json.loads(result.stdout)
        from ipaddress import ip_address, ip_network
        for item in addresses if isinstance(addresses, list) else [addresses]:
            address = ip_address(item["IPAddress"])
            network = ip_network(f"{address}/{item['PrefixLength']}", strict=False)
            if any(network.subnet_of(ip_network(value)) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
                return str(address), str(network)
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        pass
    return None


def allow_lan(address, port):
    script = Path(sys._MEIPASS) / "configure-lan-firewall.ps1"
    command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), "-LanAddress", address, "-Port", str(port)]
    result = subprocess.run(command + ["-CheckOnly"], capture_output=True, text=True, timeout=20,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode == 0 and result.stdout.strip() == "True":
        return
    # Windows shows its own one-time administrator consent; the helper stays hidden.
    arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + str(script) + "\" -LanAddress " + address + " -Port " + str(port)
    escaped = arguments.replace("'", "''")
    elevation = "Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '" + escaped + "'"
    subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", elevation],
                   capture_output=True, timeout=120, creationflags=subprocess.CREATE_NO_WINDOW)


def main():
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    multiprocessing.freeze_support()
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="拼豆本机/可信局域网入口")
    parser.add_argument("--port", type=int, default=5188)
    parser.add_argument("--lan-address")
    parser.add_argument("--lan-network")
    parser.add_argument("--local-only", action="store_true", help="仅允许本机访问")
    parser.add_argument("--open-browser", action="store_true")
    parser.add_argument("--configure", action="store_true", help="打开网页模型设置")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1–65535 之间")
    frozen = bool(getattr(sys, "frozen", False))
    # Keep concurrent double-clicks from starting two servers before the port binds.
    if frozen and os.name == "nt":
        import ctypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        kernel.CreateMutexW.restype = ctypes.c_void_p
        mutex = kernel.CreateMutexW(None, False, f"Local\\Pindou-Web-{args.port}")
        if not mutex:
            raise OSError("无法创建应用启动锁")
        if ctypes.get_last_error() == 183:
            open_browser_when_ready(args.port, args.configure)
            return
    try:
        connection = socket.create_connection(("127.0.0.1", args.port), timeout=0.5)
    except (ConnectionRefusedError, TimeoutError):
        pass
    else:
        with connection:
            try:
                with urlopen(f"http://localhost:{args.port}/api/health", timeout=2) as response:
                    if json.load(response).get("service") != "perlabo-web":
                        raise RuntimeError("端口已被其他程序占用")
                with urlopen(Request(f"http://localhost:{args.port}/api/local/info", headers={"X-Pindou-Local": "1"}), timeout=2) as response:
                    if json.load(response).get("desktop_version") != "0.2.0":
                        raise RuntimeError("请先退出旧版本，再启动新版")
            except (OSError, ValueError) as exc:
                raise RuntimeError("端口已被其他程序或旧版拼豆占用，请先退出") from exc
            open_browser_when_ready(args.port, args.configure)
            return
    config_dir = Path(sys.executable).parent if frozen else Path(__file__).resolve().parent
    config_path = config_dir / ".env"
    os.environ["PINDOU_CONFIG_PATH"] = str(config_path)
    load_dotenv(config_path, override=False)
    from app.local_settings import load_saved_model
    load_saved_model(config_path)
    if frozen:
        os.environ.setdefault("PINDOU_RUNTIME_DIR", str(config_dir / "runtime"))
        if not args.lan_address and not args.local_only:
            lan = detect_lan()
            if lan:
                args.lan_address, args.lan_network = lan
    if args.local_only and args.lan_address:
        parser.error("--local-only 不能与局域网参数同时使用")
    from app.local_app import create_local_app
    application = create_local_app(port=args.port, lan_address=args.lan_address, lan_network=args.lan_network)
    if frozen and args.lan_address:
        try:
            allow_lan(args.lan_address, args.port)
        except (OSError, subprocess.TimeoutExpired):
            pass  # Local UI explains firewall access if consent is declined.
    server = uvicorn.Server(uvicorn.Config(application, host="0.0.0.0" if args.lan_address else "127.0.0.1",
                                          port=args.port, access_log=False, proxy_headers=False))
    application.shutdown = lambda: setattr(server, "should_exit", True)
    print(f"拼豆：http://localhost:{args.port} （网页设置中可退出应用）", flush=True)
    if args.lan_address:
        print(f"局域网：http://{args.lan_address}:{args.port}", flush=True)
    if args.open_browser or frozen or args.configure:
        threading.Thread(target=open_browser_when_ready, args=(args.port, args.configure), daemon=True).start()
    server.run()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        if getattr(sys, "frozen", False):
            directory = Path(sys.executable).parent
            try:
                (directory / "启动错误.log").write_text(traceback.format_exc(), encoding="utf-8")
            except OSError:
                pass
            import tkinter as tk
            from tkinter import messagebox
            window = tk.Tk()
            window.withdraw()
            messagebox.showerror("拼豆启动失败", "启动失败。请检查端口是否被占用、解压目录是否可写，详情见启动错误.log。")
            window.destroy()
        else:
            raise
