"""Read-only lock diagnostics: all fixtures are local and contain synthetic data."""
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import diagnose_polling_locks as diagnostic

POLLING = 'polling-' + 'a' * 64 + '.json.lock'
HTTP = 'request-budget-' + 'b' * 16 + '.json.lock'


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.now = 2000000000

    def lock(self, name, age):
        p = self.root / name
        p.write_text('SYNTHETIC_PASSWORD_NOT_TO_BE_READ', encoding='utf-8')
        os.utime(p, (self.now - age, self.now - age))
        return p

    def test_recent_old_and_future_are_not_claimed_confirmed_orphans(self):
        self.lock(POLLING, 2000)
        self.lock(HTTP, 1)
        old, recent = diagnostic.scan_directory(self.root, 900, self.now)['locks']
        self.assertEqual(old['status'], 'old-lock-owner-unknown')
        self.assertTrue(old['orphan_candidate'])
        self.assertEqual(recent['status'], 'recent-lock-owner-unknown')
        self.assertFalse(recent['orphan_candidate'])
        self.lock(HTTP, -20)
        future = diagnostic.scan_directory(self.root, 900, self.now)['locks'][1]
        self.assertEqual(future['status'], 'future-mtime-owner-unknown')
        self.assertFalse(future['orphan_candidate'])

    def test_no_reads_mutations_process_actions_or_network(self):
        self.lock(POLLING, 2000)
        ledger = self.root / POLLING.removesuffix('.lock')
        ledger.write_text('{"synthetic":"TOKEN_NOT_TO_BE_READ"}')
        (self.root / 'token-private.json.lock').write_text('UNRELATED_SECRET')
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns, p.stat().st_mode)
                  for p in self.root.iterdir()}
        output = io.StringIO()
        with patch.object(Path, 'read_text', side_effect=AssertionError('content read')), \
             patch.object(Path, 'read_bytes', side_effect=AssertionError('content read')), \
             patch('socket.create_connection', side_effect=AssertionError('network')), \
             patch('subprocess.run', side_effect=AssertionError('process action')), \
             contextlib.redirect_stdout(output):
            self.assertEqual(diagnostic.main(['--cache-dir', str(self.root), '--json']), 0)
        report = json.loads(output.getvalue())
        self.assertTrue(report['read_only'])
        self.assertTrue(report['snapshot_only'])
        self.assertEqual(len(report['directories'][0]['locks']), 1)
        self.assertNotIn('SYNTHETIC_PASSWORD', output.getvalue())
        self.assertNotIn('TOKEN_NOT_TO_BE_READ', output.getvalue())
        self.assertIn('Never delete/reset budget JSON', ' '.join(report['recovery']))
        after = {p.name: (p.read_bytes(), p.stat().st_mtime_ns, p.stat().st_mode)
                 for p in self.root.iterdir()}
        self.assertEqual(before, after)

    def test_default_locations_without_opening_secret_file(self):
        secret = self.root / 'private' / 'accounts.local.json'
        with patch.object(Path, 'read_text', side_effect=AssertionError('secret read')):
            roots = diagnostic.default_directories(
                {'MMM_KIA_SECRETS_FILE': str(secret)}, self.root / 'module')
        self.assertEqual(roots, [self.root / 'module' / 'cache', secret.parent / 'state' / 'cache'])
        with self.assertRaises(ValueError):
            diagnostic.default_directories({'MMM_KIA_SECRETS_FILE': 'relative'}, self.root)

    def test_missing_and_unreadable_directory(self):
        self.assertEqual(diagnostic.scan_directory(self.root / 'missing', 900)['status'], 'missing')
        with patch.object(Path, 'iterdir', side_effect=PermissionError):
            self.assertEqual(diagnostic.scan_directory(self.root, 900)['status'], 'metadata-unavailable')

    @unittest.skipIf(os.name == 'nt', 'Windows symlink creation may require elevated privileges')
    def test_symlink_locks_and_directories_are_not_followed(self):
        target = self.root / 'secret'
        target.write_text('PRIVATE')
        (self.root / POLLING).symlink_to(target)
        result = diagnostic.scan_directory(self.root, 900)
        self.assertEqual(result['locks'][0]['status'], 'symlink-lock-not-inspected')
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        self.assertEqual(diagnostic.scan_directory(alias, 900)['status'], 'symlink-directory-not-inspected')

    def test_invalid_age_is_rejected_and_empty_scan_has_recovery_guidance(self):
        for bad in ('0', '-1', 'nan', 'inf'):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as exc:
                diagnostic.main(['--older-than-minutes', bad])
            self.assertEqual(exc.exception.code, 2)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(diagnostic.main(['--cache-dir', str(self.root)]), 0)
        self.assertIn('No recognized polling locks', output.getvalue())
        self.assertIn('no actions performed', output.getvalue())
        self.assertIn('Age alone cannot establish', output.getvalue())


if __name__ == '__main__':
    unittest.main()
