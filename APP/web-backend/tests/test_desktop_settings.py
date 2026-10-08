import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dotenv import dotenv_values
from desktop_settings import save_api_key


class DesktopSettingsTests(unittest.TestCase):
    def test_key_is_saved_locally_and_other_settings_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ):
            path = Path(directory) / '.env'
            path.write_text('PINDOU_RATE_MAX_CONVERSIONS=20\n', encoding='utf-8')
            key = 'sk-' + 'fixture' * 4
            save_api_key(path, ' ' + key + ' ')
            self.assertEqual(dotenv_values(path)['DASHSCOPE_API_KEY'], key)
            self.assertEqual(dotenv_values(path)['PINDOU_RATE_MAX_CONVERSIONS'], '20')
            self.assertEqual(os.environ['DASHSCOPE_API_KEY'], key)

    def test_invalid_key_does_not_overwrite_existing_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            original = 'DASHSCOPE_API_KEY=unchanged\n'
            path.write_text(original, encoding='utf-8')
            for value in ('', 'password', 'sk-short', 'sk-' + 'x' * 20 + '\nOTHER=value'):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    save_api_key(path, value)
                self.assertEqual(path.read_text(encoding='utf-8'), original)
