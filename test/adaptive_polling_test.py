"""Mock-only bridge tests: no account, network, or vehicle."""
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kia_client as client

class Manager:
    def __init__(self, charging=True, plug=2, age=0):
        self.v = SimpleNamespace(id="mock", ev_battery_is_charging=charging,
            ev_battery_is_plugged_in=plug,
            last_updated_at=datetime.now(timezone.utc)-timedelta(seconds=age))
        self.wakes = []
    def force_refresh_vehicle_state(self, key): self.wakes.append(key)
    def force_refresh_all_vehicles_states(self): raise AssertionError("account-wide wake")

for charging, plug, age, expected in [(True,2,0,True),(False,2,0,False),(True,0,0,False),(True,2,1300,False),(None,2,0,False)]:
    vm = Manager(charging, plug, age)
    with patch.object(client, 'connect', return_value=(vm,None)), \
         patch.object(client, '_refresh_cached_state'), \
         patch.object(client, '_select_vehicles', return_value=[vm.v]), \
         patch.object(client, 'dump_vehicle', return_value={'last_updated_at':'mock'}), \
         patch.object(client, 'token_dict', return_value=None):
        result = client.fetch({'refresh':True, 'adaptivePolling':{'statusMaxAge':1200000}, 'forceRefreshTimeout':1})
    assert bool(vm.wakes) == expected
    assert result['meta']['adaptiveLive'] == expected
    if expected:
        assert 'unverifiable' in result['meta']['note']
print('adaptive bridge tests passed')

# Authentication/timeout-style exceptions fail the live operation, never silently
# authorize continued live reads with the cached success payload.
vm = Manager()
with patch.object(client, 'connect', return_value=(vm,None)), \
     patch.object(client, '_refresh_cached_state'), \
     patch.object(client, '_select_vehicles', return_value=[vm.v]), \
     patch.object(vm, 'force_refresh_vehicle_state', side_effect=TimeoutError('mock')):
    try:
        client.fetch({'refresh':True, 'adaptivePolling':{'statusMaxAge':1200000}, 'forceRefreshTimeout':1})
        raise AssertionError('expected live failure')
    except client.ClientError:
        pass
