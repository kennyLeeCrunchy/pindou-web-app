"""Build the Windows app without copying local credentials or user data."""
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "APP/web-backend"
FRONTEND = ROOT / "APP/web-frontend"
BUILD = ROOT / ".tmp/portable"
OUTPUT = ROOT / "releases/v0.1.0"


if __name__ == "__main__":
    if not (FRONTEND / "dist/index.html").is_file():
        raise SystemExit("Run npm run build in APP/web-frontend first.")
    command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
               "--name", "Pindou", "--specpath", str(BUILD), "--workpath", str(BUILD / "work"),
               "--distpath", str(BUILD / "dist"), "--paths", str(BACKEND),
               "--add-data", f"{BACKEND / 'app/data'};app/data",
               "--add-data", f"{BACKEND / 'color_standards/mard_221_colors_vertical.csv'};color_standards",
               "--add-data", f"{FRONTEND / 'dist'};web-frontend/dist",
               "--collect-submodules", "uvicorn"]
    for module in ("torch", "transformers", "tensorflow", "matplotlib", "pandas", "IPython", "scipy"):
        command.extend(["--exclude-module", module])
    subprocess.run(command + [str(BACKEND / "run_local.py")], cwd=ROOT, check=True)
    folder = BUILD / "dist/Pindou"
    shutil.copyfile(ROOT / "docs/WINDOWS.md", folder / "使用说明.txt")
    (folder / "配置 AI 密钥.cmd").write_text('@echo off\npushd "%~dp0"\nPindou.exe --configure\nif errorlevel 1 pause\npopd\n', encoding="ascii")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive = OUTPUT / "pindou-web-windows-x64.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for file in folder.rglob("*"):
            if file.is_file():
                assert file.name != '.env' and 'runtime' not in file.relative_to(folder).parts
                package.write(file, "Pindou/" + file.relative_to(folder).as_posix())
    print(f"Built {archive} ({archive.stat().st_size // 1024 // 1024} MiB)")
