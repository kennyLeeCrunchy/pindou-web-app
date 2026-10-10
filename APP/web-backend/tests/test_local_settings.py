import base64
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from dotenv import dotenv_values
from PIL import Image
from starlette.testclient import TestClient
from app.local_app import create_local_app
from app.local_settings import model_config, public_config, save_config, load_saved_model
from app.core.openai_image_edit import OpenAIImageEditClient
from app.api import routes_conversion as route

class ModelSettingsTests(unittest.TestCase):
    def setUp(self):
        env=patch.dict(os.environ, {'DASHSCOPE_API_KEY':'fixture-old-secret', 'DASHSCOPE_BASE_URL':'https://dashscope.aliyuncs.com/api/v1','PINDOU_WEB_I2I_MODEL':'qwen-image-3.0-pro','PINDOU_AI_PROTOCOL':'dashscope','PINDOU_AI_PROVIDER':'阿里云百炼'})
        env.start();self.addCleanup(env.stop)
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.path=Path(temp.name);self.env=self.path/'.env'
        self.env.write_text('OTHER_SETTING=keep\n',encoding='utf-8')
        (self.path/'index.html').write_text('ui')
        os.environ['PINDOU_CONFIG_PATH']=str(self.env)
        self.app=create_local_app(self.path)
        self.client=TestClient(self.app,base_url='http://localhost:5188',headers={'X-Pindou-Local':'1'})
    def config(self,**changes):
        return {**model_config(),**changes}
    def test_saves_without_echoing_key_and_preserves_other_env(self):
        response=self.client.put('/api/local/settings',json=self.config(api_key='fixture-new-secret',model='custom-image'))
        self.assertEqual(response.status_code,200,response.text)
        self.assertNotIn('fixture-new-secret',response.text)
        self.assertNotIn('api_key',response.json())
        self.assertEqual(dotenv_values(self.env)['OTHER_SETTING'],'keep')
        self.assertEqual(model_config()['model'],'custom-image')
        self.assertEqual(dotenv_values(self.env)['DASHSCOPE_API_KEY'],'fixture-new-secret')
        self.assertEqual(self.client.get('/api/local/settings').headers['cache-control'],'no-store')
    def test_invalid_settings_and_blank_key_destination_change_cannot_overwrite(self):
        original=self.env.read_text(encoding="utf-8")
        for changes in ({'base_url':'http://remote.example/v1'},{'base_url':'https://a.example/#x'}, {'base_url':'https://user:pass@a.example'}, {'model':'a\nOTHER=x'}, {'api_key':'key\nOTHER=x'},{'protocol':'chat'}, {'api_key':'','base_url':'https://different.example/v1'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.client.put('/api/local/settings',json=self.config(**changes)).status_code,400)
                self.assertEqual(self.env.read_text(encoding="utf-8"),original)
                self.assertEqual(model_config()['api_key'],'fixture-old-secret')
    def test_blank_preserves_key_and_failed_write_preserves_memory(self):
        save_config(self.env,self.config(api_key=''))
        self.assertEqual(model_config()['api_key'],'fixture-old-secret')
        original=self.env.read_text(encoding="utf-8")
        with patch('app.local_settings.os.replace',side_effect=OSError('fixture')):
            self.assertEqual(self.client.put('/api/local/settings',json=self.config(api_key='fixture-new-key')).status_code,500)
        self.assertEqual(model_config()['api_key'],'fixture-old-secret')
        self.assertEqual(self.env.read_text(encoding="utf-8"),original)
    def test_lan_cannot_read_change_or_stop_but_can_read_address(self):
        app=create_local_app(self.path,lan_address='192.168.31.202',lan_network='192.168.31.0/24')
        client=TestClient(app,base_url='http://192.168.31.202:5188',client=('192.168.31.10',1234),headers={'X-Pindou-Local':'1'})
        for method,path in [('get','/api/local/settings'),('put','/api/local/settings'),('post','/api/local/shutdown')]:
            self.assertEqual(getattr(client,method)(path).status_code,403)
        self.assertEqual(client.get('/api/local/info').json()['lan_url'],'http://192.168.31.202:5188')
    def test_marker_and_origin_still_required_for_settings(self):
        for headers in ({'Origin':'https://foreign.example'},{'X-Pindou-Local':'0'},{'Host':'foreign.example'}):
            self.assertEqual(self.client.put('/api/local/settings',json=self.config(),headers=headers).status_code,403)
        self.assertEqual(self.client.put('/api/local/settings',content=b'x'*8193).status_code,400)
    def test_restart_loads_persisted_configuration_without_secret_in_public_result(self):
        save_config(self.env,self.config(provider='测试供应商',protocol='openai',base_url='https://images.example/v1',model='gpt-image-test',api_key='fixture-test-key'))
        saved=dotenv_values(self.env)
        self.assertEqual(saved['PINDOU_AI_PROTOCOL'],'openai')
        self.assertEqual(saved['PINDOU_WEB_I2I_MODEL'],'gpt-image-test')
        os.environ['PINDOU_AI_PROTOCOL']='dashscope'
        os.environ['DASHSCOPE_API_KEY']='old-shell-key'
        load_saved_model(self.env)
        self.assertEqual(model_config()['protocol'],'openai')
        self.assertEqual(model_config()['api_key'],'fixture-test-key')
        self.assertNotIn('fixture-test-key',json.dumps(public_config()))

class OpenAIEditTests(unittest.TestCase):
    def test_multipart_endpoint_model_prompt_and_base64_image(self):
        output=io.BytesIO();Image.new('RGB',(32,32),'red').save(output,format='PNG');png=output.getvalue()
        real_client=httpx.Client
        for model in ('gpt-image-test','compatible-image'):
            def handler(request):
                self.assertEqual(str(request.url),'http://127.0.0.1:43210/v1/images/edits')
                self.assertEqual(request.headers['authorization'],'Bearer fixture-key')
                self.assertIn(model.encode(),request.content)
                self.assertIn(b'filename="image.png"',request.content)
                self.assertEqual(b'response_format' in request.content,not model.startswith('gpt-image'))
                return httpx.Response(200,json={'data':[{'b64_json':base64.b64encode(png).decode()}]})
            with patch('app.core.openai_image_edit.httpx.Client',side_effect=lambda **kwargs:real_client(transport=httpx.MockTransport(handler),**kwargs)):
                result=OpenAIImageEditClient('fixture-key','http://127.0.0.1:43210/v1',model).edit('data:image/png;base64,'+base64.b64encode(png).decode(),'make pixels',negative_prompt='blurry')
                self.assertEqual(result[1],png)
    def test_no_redirects_or_invalid_base64(self):
        real_client=httpx.Client
        for response in (httpx.Response(302,headers={'location':'https://foreign.example'}),httpx.Response(200,json={'data':[{'b64_json':'@bad'}]})):
            with patch('app.core.openai_image_edit.httpx.Client',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(lambda r:response),**kw)):
                with self.assertRaises((ValueError,RuntimeError,httpx.HTTPStatusError)):
                    OpenAIImageEditClient('fixture-key','https://images.example/v1','gpt-image-test').edit('data:image/png;base64,aGVsbG8=','pixels')
    def test_url_return_cannot_fetch_arbitrary_host(self):
        with self.assertRaises(ValueError):
            route.download_image('https://127.0.0.1/private',1,trusted_base_url='https://images.example/v1')

class LauncherTests(unittest.TestCase):
    def test_lan_detection_uses_hidden_helper_and_rejects_public_subnet(self):
        import run_local
        from types import SimpleNamespace
        for address, prefix, expected in [('192.168.3.20',24,('192.168.3.20','192.168.3.0/24')),('198.18.0.1',30,None),('192.168.3.20',8,None)]:
            with patch.object(run_local.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps({'IPAddress':address,'PrefixLength':prefix}))) as command:
                self.assertEqual(run_local.detect_lan(),expected)
                self.assertEqual(command.call_args.kwargs['creationflags'],run_local.subprocess.CREATE_NO_WINDOW)

    def test_dashscope_never_forwards_key_on_redirect(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading
        from app.core.image_edit_client import DashScopeImageEditClient
        reached=[]
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path=='/redirect':
                    self.send_response(302);self.send_header('Location','/target');self.end_headers()
                else:
                    reached.append(self.headers.get('Authorization'));self.send_response(200);self.end_headers();self.wfile.write(b'{}')
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with self.assertRaises(RuntimeError):
                DashScopeImageEditClient._request_json(f'http://127.0.0.1:{server.server_port}/redirect',method='GET',headers={'Authorization':'Bearer fixture-key'})
            self.assertEqual(reached,[])
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
