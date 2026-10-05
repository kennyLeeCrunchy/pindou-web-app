"""Offline Linux/Windows native smoke check; no cloud quota/model requests."""
import base64
import io
import multiprocessing
import os
import time
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.api_main import app
from app.api import routes_conversion as route


def main():
    import cv2
    token = 'offline-web-token-for-native-smoke-test-only'
    with patch.dict(os.environ, {'PINDOU_WEB_ACCESS_TOKEN': token, 'PINDOU_QUOTA_BACKEND': 'local'}):
        client = TestClient(app)
        health = client.get('/api/health')
        assert health.status_code == 200 and health.json()['service'] == 'perlabo-web'
        for path in ['/docs', '/openapi.json', '/api/auth/login', '/api/ai/generate', '/runtime/generated/old.png']:
            assert client.get(path).status_code == 404, path
        assert client.get('/api/auth/quota').status_code == 401
        assert client.post('/api/export/png', json={}).status_code == 401
        assert client.get('/api/auth/quota', headers={'Authorization': 'Bearer ' + token}).status_code == 200
        origin = os.getenv('PINDOU_CORS_ORIGINS', 'http://localhost:5180').split(',')[0].strip()
        preflight = client.options('/api/pattern/prepare', headers={
            'Origin': origin, 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,content-type',
        })
        assert preflight.status_code == 200
        assert preflight.headers['access-control-allow-origin'] == origin

    image = Image.new('RGB', (128, 128), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((48, 15, 80, 35), fill='#d38d5f')
    draw.rectangle((32, 36, 96, 78), fill='white', outline='#999999', width=3)
    draw.rectangle((38, 79, 55, 113), fill='#166768')
    draw.rectangle((73, 79, 90, 113), fill='#166768')
    output = io.BytesIO()
    image.save(output, format='PNG')
    options = dict(user_id='offline', request_id='offline-request-00001', mode='cartoon_direct',
                   framing_mode='flat', subject_target='', prompt='', brand='Artkal',
                   preset='221', colors=12, color_selection='auto')
    prepared = route._run_conversion(output.getvalue(), {**options, 'operation': 'prepare'}, time.monotonic() + 30)
    assert prepared['phase'] == 'prepared' and 'variants' not in prepared
    assert prepared['mask_method'] == 'demo_pixel_grabcut'
    assert prepared['model_input_image_count'] == 0
    prepared_bytes = base64.b64decode(prepared['prepared_image_url'].split(',')[1])
    result = route._run_conversion(prepared_bytes, options, time.monotonic() + 30)
    assert [item['width'] for item in result['variants']] == [52, 78, 104]
    assert result['mask_method'] == 'alpha' and result['ai_passes'] == 0
    started = time.monotonic()
    try:
        route._run_conversion(output.getvalue(), options, started + 0.01)
        raise AssertionError('Deadline not enforced')
    except HTTPException as exc:
        assert exc.status_code == 504
    assert time.monotonic() - started < 3 and not multiprocessing.active_children()
    print(f'PASS native OpenCV {cv2.__version__}, Web health/auth/CORS, two-step non-AI conversion and timeout cleanup; no cloud/model calls.')


if __name__ == '__main__':
    main()
