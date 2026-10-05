"""Build the Linux Python 3.10 HTTP function ZIP from Windows or Linux."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
ROOT = BACKEND.parents[1]
BUILD = ROOT / '.tmp' / 'web-cloudbase-package'


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    wheels = BUILD / 'wheels'
    assert wheels.resolve().parent == BUILD.resolve()
    if wheels.exists():
        shutil.rmtree(wheels)
    wheels.mkdir(exist_ok=True)
    subprocess.run([sys.executable, '-m', 'pip', 'download', '--platform', 'manylinux2014_x86_64',
                    '--python-version', '310', '--implementation', 'cp', '--abi', 'cp310',
                    '--only-binary=:all:', '-r', str(HERE / 'requirements.txt'), '-d', str(wheels)], check=True)
    package = BUILD / 'code'
    # Delete only this fixed build directory, after checking its resolved parent.
    assert package.resolve().parent == BUILD.resolve()
    if package.exists():
        shutil.rmtree(package)
    (package / 'third_party').mkdir(parents=True)
    for wheel in wheels.glob('*.whl'):
        with zipfile.ZipFile(wheel) as archive:
            for entry in archive.infolist():
                target = package / 'third_party' / entry.filename
                if not target.resolve().is_relative_to((package / 'third_party').resolve()):
                    raise ValueError('Unsafe wheel path')
            archive.extractall(package / 'third_party')
    shutil.copytree(BACKEND / 'app', package / 'app',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.env', '.env.*', 'runtime'))
    shutil.copytree(BACKEND / 'color_standards', package / 'color_standards')
    shutil.copy2(HERE / 'scf_bootstrap', package / 'scf_bootstrap')
    (package / 'requirements.lock.txt').write_text('\n'.join(sorted(p.name for p in wheels.glob('*.whl'))) + '\n')
    output = BUILD / 'pindou-web-python310.zip'
    total = 0
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(package.rglob('*')):
            if not path.is_file():
                continue
            relative = path.relative_to(package).as_posix()
            info = zipfile.ZipInfo(relative)
            info.create_system = 3
            info.external_attr = (0o100755 if relative == 'scf_bootstrap' else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            data = path.read_bytes()
            if relative == 'scf_bootstrap':
                data = data.replace(b'\r\n', b'\n')
            total += len(data)
            archive.writestr(info, data)
    assert total < 500 * 1024 * 1024, 'Package exceeds function limit'
    # Keep published versions outside the disposable dependency/build directory.
    release = ROOT / 'releases' / 'web' / datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d-%H%M%S-cloudbase')
    release.mkdir(parents=True, exist_ok=False)
    artifact = release / output.name
    output.replace(artifact)
    output = artifact
    (release / 'manifest.json').write_text(json.dumps({
        output.name: {'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()},
    }, indent=2) + '\n', encoding='utf-8')
    print(f'{output}\nZIP: {output.stat().st_size / 1048576:.1f} MB; unpacked: {total / 1048576:.1f} MB')


if __name__ == '__main__':
    main()
