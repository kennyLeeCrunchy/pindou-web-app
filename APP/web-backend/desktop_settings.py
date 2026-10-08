"""Local desktop credential setup; never sent to the browser."""
from __future__ import annotations

import os
import re
from pathlib import Path

from dotenv import set_key


def save_api_key(path: Path, value: str) -> None:
    value = value.strip()
    if not re.fullmatch(r"sk-[A-Za-z0-9_-]{16,}", value):
        raise ValueError("请输入完整的阿里云 API Key（以 sk- 开头）。")
    set_key(path, "DASHSCOPE_API_KEY", value)
    os.environ["DASHSCOPE_API_KEY"] = value


def configure_api_key(path: Path) -> bool:
    import tkinter as tk
    from tkinter import messagebox, ttk

    window = tk.Tk()
    window.title("拼豆助手 · AI 密钥配置")
    window.resizable(False, False)
    frame = ttk.Frame(window, padding=24)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="配置阿里云北京 API Key", font=("Microsoft YaHei", 14, "bold")).pack(anchor="w")
    ttk.Label(frame, text="仅保存到本机，用于照片 AI 重绘。\n直接转图纸无需密钥；模型调用使用你自己的余额。", padding=(0, 12)).pack(anchor="w")
    value = tk.StringVar(value=os.getenv("DASHSCOPE_API_KEY", ""))
    entry = ttk.Entry(frame, textvariable=value, show="●", width=54)
    entry.pack(fill="x", pady=(0, 8))
    ttk.Label(frame, text="请从阿里云百炼北京地域复制 Key，不要填写账号密码。", foreground="#7b6257").pack(anchor="w")
    accepted = False

    def save():
        nonlocal accepted
        try:
            save_api_key(path, value.get())
        except ValueError as exc:
            messagebox.showerror("请检查密钥", str(exc), parent=window)
            return
        except OSError:
            messagebox.showerror("无法保存", "请将应用解压到可写目录后再配置。", parent=window)
            return
        accepted = True
        window.destroy()

    def skip():
        nonlocal accepted
        accepted = True
        window.destroy()

    actions = ttk.Frame(frame, padding=(0, 18, 0, 0))
    actions.pack(fill="x")
    ttk.Button(actions, text="保存", command=save).pack(side="right")
    ttk.Button(actions, text="暂不配置", command=skip).pack(side="right", padx=12)
    ttk.Label(frame, text="以后可双击“配置 AI 密钥.cmd”修改，保存后重启应用。", padding=(0, 14, 0, 0)).pack(anchor="w")
    entry.focus_set()
    window.bind("<Return>", lambda event: save())
    window.mainloop()
    return accepted
