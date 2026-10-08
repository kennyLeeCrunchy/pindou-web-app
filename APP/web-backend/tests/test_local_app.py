import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient
from app.local_app import create_local_app


class LocalAppTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name)
        (self.path / 'index.html').write_text('<h1>Local UI</h1>')
        self.client = TestClient(create_local_app(self.path), base_url='http://localhost:5188')

    def test_serves_ui_and_authenticates_local_api_without_exposing_secret(self):
        ui = self.client.get('/')
        self.assertEqual(ui.status_code, 200)
        self.assertNotIn(os.environ['PINDOU_WEB_ACCESS_TOKEN'], ui.text)
        quota = self.client.get('/api/auth/quota', headers={'X-Pindou-Local': '1'})
        self.assertEqual(quota.status_code, 200, quota.text)
        self.assertEqual(os.environ['PINDOU_QUOTA_BACKEND'], 'local')

    def test_rejects_foreign_origin_rebinding_host_and_missing_marker(self):
        for headers in (
            {'X-Pindou-Local': '1', 'Origin': 'https://foreign.example'},
            {'X-Pindou-Local': '1', 'Host': 'foreign.example:5180'},
            {'X-Pindou-Local': '1', 'Sec-Fetch-Site': 'cross-site'},
            {},
        ):
            with self.subTest(headers=headers):
                self.assertEqual(self.client.get('/api/auth/quota', headers=headers).status_code, 403)

    def test_frontend_dev_proxy_can_access_the_local_api(self):
        response = self.client.get('/api/auth/quota', headers={'X-Pindou-Local': '1', 'Origin': 'http://127.0.0.1:5181'})
        self.assertEqual(response.status_code, 200)

    def test_private_files_are_not_served(self):
        for path in ('/.env', '/app/local_app.py', '/../web-backend/.env'):
            self.assertEqual(self.client.get(path).status_code, 404)

    def lan_client(self, peer='192.168.31.50', host='192.168.31.202:5188'):
        return TestClient(create_local_app(self.path, lan_address='192.168.31.202',
                          lan_network='192.168.31.202/24'), base_url=f'http://{host}', client=(peer, 12345))

    def test_configured_lan_can_use_same_origin_ui_and_api(self):
        client = self.lan_client()
        self.assertEqual(client.get('/').status_code, 200)
        response = client.get('/api/auth/quota', headers={
            'X-Pindou-Local': '1', 'Origin': 'http://192.168.31.202:5188'})
        self.assertEqual(response.status_code, 200, response.text)

    def test_lan_rejects_other_subnets_foreign_hosts_and_origins(self):
        for peer in ('192.168.32.50', '10.0.0.20', '198.18.0.2', '203.0.113.2'):
            with self.subTest(peer=peer):
                self.assertEqual(self.lan_client(peer).get('/').status_code, 403)
        self.assertEqual(self.lan_client(host='foreign.example').get('/').status_code, 403)
        for headers in ({'Origin': 'https://foreign.example'}, {'Sec-Fetch-Site': 'cross-site'}, {}):
            self.assertEqual(self.lan_client().get('/api/auth/quota', headers=headers).status_code, 403)

    def test_forwarded_headers_do_not_override_actual_peer(self):
        response = self.lan_client('203.0.113.2').get('/', headers={
            'X-Forwarded-For': '192.168.31.50', 'X-Forwarded-Host': '192.168.31.202:5188'})
        self.assertEqual(response.status_code, 403)

    def test_loopback_default_still_rejects_lan_peers(self):
        client = TestClient(create_local_app(self.path), base_url='http://localhost:5188',
                            client=('192.168.31.50', 12345))
        self.assertEqual(client.get('/').status_code, 403)

    def test_lan_configuration_rejects_public_virtual_and_mismatched_networks(self):
        for address, network in (
            ('192.168.31.202', '192.168.32.0/24'), ('203.0.113.2', '203.0.113.0/24'),
            ('198.18.0.1', '198.18.0.0/30'), ('192.168.31.202', '0.0.0.0/0'),
            ('::1', '::/64'), ('192.168.31.202', None),
        ):
            with self.subTest(address=address, network=network), self.assertRaises(ValueError):
                create_local_app(self.path, lan_address=address, lan_network=network)


if __name__ == '__main__':
    unittest.main()
