"""Bridge safety tests. All API calls are mocked; no vehicle is contacted."""
import sys
import unittest
from contextlib import ExitStack
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kia_client as client


class AdaptiveBridgeTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stamp = datetime.now(timezone.utc) - timedelta(seconds=10)
        self.vehicle = SimpleNamespace(id='mock-car', ev_battery_is_charging=True,
            ev_battery_is_plugged_in=2, last_updated_at=self.stamp)
        self.vm = Mock()
        self.vm.force_refresh_all_vehicles_states.side_effect = AssertionError('account-wide wake')
        self.stack.enter_context(patch.object(client, 'connect', return_value=(self.vm, None)))
        self.cached = self.stack.enter_context(patch.object(client, '_refresh_cached_state'))
        self.select = self.stack.enter_context(patch.object(client, '_select_vehicles', return_value=[self.vehicle]))
        self.stack.enter_context(patch.object(client, 'dump_vehicle', side_effect=lambda v, _: {
            'last_updated_at': v.last_updated_at.isoformat() if v.last_updated_at else None,
            'ev_battery_is_charging': v.ev_battery_is_charging}))
        self.stack.enter_context(patch.object(client, 'token_dict', return_value=None))
        self.job = {'refresh': True, 'adaptivePolling': {'statusMaxAge': 1200000}, 'forceRefreshTimeout': 1}

    def fetch(self, **changes):
        return client.fetch(dict(self.job, **changes))

    def test_fresh_charging_requests_only_selected_vehicle(self):
        def advance(_): self.vehicle.last_updated_at += timedelta(seconds=1)
        self.vm.force_refresh_vehicle_state.side_effect = advance
        result = self.fetch()
        self.vm.force_refresh_vehicle_state.assert_called_once_with('mock-car')
        self.assertTrue(result['meta']['adaptiveLive'])
        self.assertNotIn('note', result['meta'])
        self.assertEqual(self.cached.call_count, 2)

    def test_passive_startup_and_omitted_refresh_do_not_wake(self):
        self.fetch(refresh=False)
        del self.job['refresh']
        self.fetch()
        self.vm.force_refresh_vehicle_state.assert_not_called()

    def test_preflight_stopped_disconnected_stale_and_unknown_do_not_wake(self):
        for charge, plug, stamp in [(False,2,self.stamp),(True,0,self.stamp),
                (True,2,self.stamp-timedelta(hours=1)),(None,2,self.stamp),
                (True,2,None),(True,2,self.stamp.replace(tzinfo=None)),
                (True,2,self.stamp+timedelta(hours=1)),(True,99,self.stamp)]:
            with self.subTest(charge=charge, plug=plug, stamp=stamp):
                self.vehicle.ev_battery_is_charging = charge
                self.vehicle.ev_battery_is_plugged_in = plug
                self.vehicle.last_updated_at = stamp
                self.assertFalse(self.fetch()['meta']['adaptiveLive'])
        self.vm.force_refresh_vehicle_state.assert_not_called()

    def test_preflight_checks_current_cache_before_waking(self):
        def stopped(*_): self.vehicle.ev_battery_is_charging = False
        self.cached.side_effect = stopped
        self.fetch()
        self.vm.force_refresh_vehicle_state.assert_not_called()

    def test_cache_only_fetch_reads_cache_once(self):
        self.fetch(refresh=False)
        self.cached.assert_called_once()

    def test_zero_live_timeout_never_wakes(self):
        result = self.fetch(forceRefreshTimeout=0)
        self.assertFalse(result['meta']['adaptiveLive'])
        self.vm.force_refresh_vehicle_state.assert_not_called()
        self.cached.assert_called_once()

    def test_same_live_timestamp_returns_passive_latch_note(self):
        self.assertIn('unverifiable', self.fetch()['meta']['note'])

    def test_charging_finishes_during_refresh(self):
        def stop(_):
            self.vehicle.ev_battery_is_charging = False
            self.vehicle.last_updated_at += timedelta(seconds=1)
        self.vm.force_refresh_vehicle_state.side_effect = stop
        result = self.fetch()
        self.assertFalse(result['vehicles'][0]['ev_battery_is_charging'])
        self.fetch()
        self.vm.force_refresh_vehicle_state.assert_called_once()

    def test_live_exceptions_are_failures_not_cached_success(self):
        for error in [TimeoutError('mock timeout'), RuntimeError('mock authentication error')]:
            with self.subTest(error=type(error).__name__):
                self.vm.force_refresh_vehicle_state.side_effect = error
                with self.assertRaises(client.ClientError): self.fetch()

    def test_live_thread_timeout_fails_closed(self):
        thread = Mock()
        thread.is_alive.return_value = True
        with patch.object(client.threading, 'Thread', return_value=thread):
            with self.assertRaisesRegex(client.ClientError, 'timed out'): self.fetch()

    def test_rotation_never_wakes_even_one_returned_vehicle(self):
        result = self.fetch(allVehicles=True)
        self.assertFalse(result['meta']['adaptiveLive'])
        self.vm.force_refresh_vehicle_state.assert_not_called()

    def test_multiple_unscoped_vehicles_never_wake(self):
        self.select.return_value = [self.vehicle, self.vehicle]
        with self.assertRaises(client.ClientError): self.fetch()
        self.vm.force_refresh_vehicle_state.assert_not_called()

    def test_guard_counts_each_legacy_vehicle_wake(self):
        budget = Mock()
        self.vm.vehicles = {"one":self.vehicle, "two":SimpleNamespace(id="two")}
        self.fetch(adaptivePolling=None, _wakeBudget=budget)
        self.assertEqual(budget.reserve.call_count,2)
        self.assertEqual(self.vm.force_refresh_vehicle_state.call_count,2)
        self.vm.force_refresh_all_vehicles_states.assert_not_called()

    def test_disabled_adaptive_retains_legacy_force_all(self):
        self.vm.force_refresh_all_vehicles_states.side_effect = None
        self.fetch(adaptivePolling=None)
        self.vm.force_refresh_all_vehicles_states.assert_called_once()
        self.assertEqual(self.cached.call_count, 1)


if __name__ == '__main__':
    unittest.main()
