"""Durable HTTP and wake request accounting for the dedicated MM Python bridge.

This is intentionally not installed in the shared in-process Home Assistant client.
No URLs, credentials, request bodies or telemetry are stored in the ledger.
"""
import json
import math
import os
import time
from contextlib import contextmanager
from pathlib import Path


class BudgetExceeded(RuntimeError):
    pass


class Budget:
    def __init__(self, file, cap=60, now=time.time):
        self.file = Path(file)
        self.cap = min(120, max(1, int(cap))) if type(cap) in (int,float) and math.isfinite(cap) and cap>0 else 60
        self.now = now

    def reserve(self, kind):
        self.file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        lock = str(self.file) + '.lock'
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except OSError as exc:
            raise BudgetExceeded('cloud request guard unavailable; not contacting Kia') from exc
        try:
            now = self.now()
            try:
                data = json.loads(self.file.read_text(encoding='utf-8'))
                if not isinstance(data,dict) or any(not isinstance(data.get(k),list) or
                        any(type(t) not in (int,float) or not math.isfinite(t) or t<0 for t in data[k]) for k in ('http','wake')):
                    raise ValueError('bad ledger')
            except FileNotFoundError:
                data = {'http':[], 'wake':[]}
            except (ValueError,TypeError,OSError) as exc:
                raise BudgetExceeded('invalid cloud request guard; not contacting Kia') from exc
            for k in ('http','wake'):
                data[k] = [t for t in data[k] if now-t < 3600]
            limit = self.cap if kind=='http' else 6
            if len(data[kind]) >= limit:
                raise BudgetExceeded('cloud HTTP hourly limit' if kind=='http' else 'vehicle wake hourly limit')
            data[kind].append(now)
            tmp = str(self.file)+'.tmp'
            with open(tmp,'w',encoding='utf-8',opener=lambda path,flags: os.open(path,flags,0o600)) as f:
                json.dump(data,f); f.flush(); os.fsync(f.fileno())
            os.chmod(tmp,0o600)
            os.replace(tmp,self.file)
        finally:
            os.close(fd); os.unlink(lock)


@contextmanager
def protect_http(budget):
    # kia_bridge.py is a dedicated subprocess. Retain the wrapper until its
    # exit, including a timed-out daemon wake thread's remaining lifetime.
    import requests
    original = requests.Session.send
    def send(session, request, **kwargs):
        budget.reserve('http')
        return original(session,request,**kwargs)
    requests.Session.send = send
    try:
        yield
    finally:
        # Restore only when there is no orphaned request thread. The bridge
        # exits immediately after its JSON result; no unrelated caller shares it.
        import threading
        if threading.active_count()==1:
            requests.Session.send = original
