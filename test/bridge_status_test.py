"""Bridge error classifications use synthetic failures; never call Kia."""
import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kia_bridge as bridge

SECRET = 'SYNTHETIC_PASSWORD TOKEN SYNTHETIC_VIN latitude=12.345'

class AuthenticationError(Exception):
    pass

class Tests(unittest.TestCase):
    def test_fixed_classifications_and_wrapped_cause(self):
        for error, kind in [(AuthenticationError(SECRET), 'authentication'),
                            (bridge.kia_client.OtpRequired(SECRET), 'authentication'),
                            (TimeoutError(SECRET), 'network'),
                            (ConnectionError(SECRET), 'network'),
                            (ValueError(SECRET), 'processing'),
                            (RuntimeError(SECRET), 'api')]:
            with self.subTest(kind=kind):
                self.assertEqual(bridge.failure_kind(error), kind)
                wrapped = bridge.kia_client.ClientError(SECRET)
                wrapped.__cause__ = error
                self.assertEqual(bridge.failure_kind(wrapped), kind)

    def test_bridge_does_not_emit_exception_secrets(self):
        for error in [AuthenticationError(SECRET), TimeoutError(SECRET), ValueError(SECRET), RuntimeError(SECRET)]:
            output=io.StringIO()
            with patch.object(sys, 'stdin', io.StringIO('{}')), patch.object(bridge.kia_client, 'fetch', side_effect=error) as fetch, contextlib.redirect_stdout(output):
                self.assertEqual(bridge.main(), 0)
                fetch.assert_called_once()
            response=json.loads(output.getvalue())
            self.assertFalse(response['ok'])
            self.assertEqual(response['errorKind'], bridge.failure_kind(error))
            self.assertNotIn('SYNTHETIC', output.getvalue())
            self.assertNotIn('TOKEN', output.getvalue())

    def test_invalid_job_never_calls_fetch(self):
        output=io.StringIO()
        with patch.object(sys, 'stdin', io.StringIO(SECRET)), patch.object(bridge.kia_client, 'fetch') as fetch, contextlib.redirect_stdout(output):
            bridge.main()
            fetch.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['errorKind'], 'processing')
        self.assertNotIn(SECRET, output.getvalue())

if __name__ == '__main__':
    unittest.main()
