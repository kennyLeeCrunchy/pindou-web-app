from __future__ import annotations

import os

import uvicorn
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent / ".env", override=False)


if __name__ == "__main__":
    uvicorn.run(
        "app.api_main:app",
        host=os.getenv("PINDOU_HOST", "127.0.0.1"),
        port=int(os.getenv("PINDOU_PORT", "8001")),
        workers=1,
        access_log=False,
    )
