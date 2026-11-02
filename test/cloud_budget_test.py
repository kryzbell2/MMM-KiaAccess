"""Durable request accounting tests. The requests transport is always mocked."""
import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cloud_budget import Budget,BudgetExceeded,protect_http

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'budget.json';self.now=10000
    def budget(self,cap=2):return Budget(self.path,cap,now=lambda:self.now)
    def test_http_cap_survives_restart_and_failed_sends(self):
        self.budget().reserve('http');self.budget().reserve('http')
        with self.assertRaises(BudgetExceeded):self.budget().reserve('http')
        self.now+=3601;self.budget().reserve('http')
    def test_wake_cap_is_separate_and_stricter(self):
        for _ in range(6):self.budget(60).reserve('wake')
        with self.assertRaises(BudgetExceeded):self.budget(60).reserve('wake')
        self.budget(60).reserve('http')
    def test_lock_and_corrupt_state_fail_closed(self):
        lock=Path(str(self.path)+'.lock');lock.write_text('')
        with self.assertRaises(BudgetExceeded):self.budget().reserve('http')
        lock.unlink();self.path.write_text('{broken')
        with self.assertRaises(BudgetExceeded):self.budget().reserve('http')
    def test_transport_is_counted_before_network_and_secrets_never_persist(self):
        import requests
        with patch.object(requests.Session,'send',return_value=object()) as transport:
            with protect_http(self.budget()):
                for _ in range(2):requests.Session().send(object())
                with self.assertRaises(BudgetExceeded):requests.Session().send(object())
            self.assertEqual(transport.call_count,2)
        self.assertEqual(set(json.loads(self.path.read_text())),{'http','wake'})
    def test_bad_caps_never_mean_unlimited(self):
        for value in (0,-1,'10',None,float('nan'),float('inf')):
            self.assertEqual(self.budget(value).cap,60)

if __name__=='__main__': unittest.main()
