import contextlib,io,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import enroll_server as enroll

class Tests(unittest.TestCase):
    def test_private_profile_and_enrollment_handoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);web=root/'web';web.mkdir()
            file=root/'accounts.local.json'
            secret={'stateDirectory':str(root/'state'),'username':'SYNTHETIC_USER','password':'SYNTHETIC_PASSWORD','pin':'1357','region':'USA','brand':'KIA'}
            file.write_text(json.dumps({'profiles':{'bluebell':secret}}));file.chmod(0o600)
            loaded=enroll.load_profile(file,'bluebell',web)
            self.assertEqual(loaded,secret)
            self.assertEqual(loaded['stateDirectory'],str(root/'state'))
            def invoke(argv,env):
                self.assertEqual(json.loads(env['KIA_JOB']),secret)
                self.assertNotIn(secret['password'],' '.join(argv))
                return 0
            with patch.dict(os.environ,{'MMM_KIA_SECRETS_FILE':str(file)}),patch.object(sys,'argv',['enroll_server.py','--profile','bluebell']),patch.object(enroll,'load_profile',return_value=secret),patch.object(enroll.subprocess,'call',side_effect=invoke):
                self.assertEqual(enroll.main(),0)
            exposed=web/'accounts.local.json';exposed.write_text(file.read_text())
            with self.assertRaises(ValueError):enroll.load_profile(exposed,'bluebell',web)
            if os.name!='nt':
                file.chmod(0o644)
                with self.assertRaises(ValueError):enroll.load_profile(file,'bluebell',web)
    def test_bad_profile_never_invokes_authentication(self):
        output=io.StringIO()
        with patch.dict(os.environ,{'MMM_KIA_SECRETS_FILE':'relative'}),patch.object(sys,'argv',['enroll_server.py','--profile','bluebell']),patch.object(enroll.subprocess,'call') as call,contextlib.redirect_stderr(output):
            self.assertEqual(enroll.main(),1);call.assert_not_called()
        self.assertNotIn('SYNTHETIC',output.getvalue())

    def test_state_migration_preserves_token_bytes_and_guards(self):
        import kia_client,migrate_server_state
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'module';source.mkdir();(source/'cache').mkdir()
            job={'username':'SYNTHETIC_USER','region':'USA','brand':'KIA','stateDirectory':str(root/'private')}
            name=Path(kia_client.account_token_file(job)).name
            token=b'{"synthetic":"SYNTHETIC_TOKEN"}'
            (source/name).write_bytes(token)
            (source/'cache'/'polling-test.json').write_text('{"synthetic":true}')
            self.assertEqual(migrate_server_state.migrate(source,job),2)
            self.assertTrue((source/name).exists())
            self.assertEqual(migrate_server_state.migrate(source,job,True),2)
            self.assertFalse((source/name).exists())
            self.assertEqual(Path(kia_client.account_token_file(job)).read_bytes(),token)
            self.assertTrue((root/'private'/'cache'/'polling-test.json').exists())
            (source/name).write_bytes(token)
            with self.assertRaises(ValueError):migrate_server_state.migrate(source,job,True)
            with self.assertRaises(kia_client.OtpRequired):kia_client.connect({**job,'stateDirectory':str(root/'missing')})

    def test_enrollment_unknown_result_is_not_dumped(self):
        import enroll as original
        class Unexpected:
            def __repr__(self): return 'SYNTHETIC_PASSWORD'
        from unittest.mock import Mock
        vm=Mock();vm.login.return_value=Unexpected()
        output=io.StringIO()
        with patch.object(original,'load_job',return_value={'username':'u','password':'p','brand':'KIA','region':'USA'}),patch('hyundai_kia_connect_api.VehicleManager',return_value=vm),contextlib.redirect_stderr(output):
            self.assertNotEqual(original.main(),0)
        self.assertNotIn('SYNTHETIC_PASSWORD',output.getvalue())

    def test_bridge_never_echoes_exception_credentials(self):
        import kia_bridge
        for error in (RuntimeError('SYNTHETIC_PASSWORD'),kia_bridge.kia_client.ClientError('SYNTHETIC_PASSWORD')):
            output=io.StringIO()
            with patch.object(sys,'stdin',io.StringIO('{}')),patch.object(kia_bridge.kia_client,'fetch',side_effect=error),contextlib.redirect_stdout(output):
                self.assertEqual(kia_bridge.main(),0)
            self.assertNotIn('SYNTHETIC_PASSWORD',output.getvalue())
            self.assertFalse(json.loads(output.getvalue())['ok'])

if __name__=='__main__':unittest.main()
