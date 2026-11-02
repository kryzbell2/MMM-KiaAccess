# Adaptive polling startup feasibility

This is an investigation, not permission to change production polling. No vehicle
or Pi was contacted. Conclusions come from `adaptive_polling.js`,
`polling_guard.js`, `kia_client.py` and mocked tests, not measured Kia cache cadence.

## Can it activate without a manual refresh?

Yes, **only if Kia independently publishes sufficiently fresh charging telemetry**.
The Node policy requires a timezone-qualified report at most 20 minutes old,
charging true/1, a recognized connected connector, an unblocked session and an
available persisted wake budget. Python rechecks current cloud cache immediately
before any targeted wake. A successful cached HTTP request does not renew the
vehicle timestamp or qualify an old charging reading.

The one-hour startup restriction is an **unknown-budget cooldown**, created when
no valid persisted guard ledger exists. With a valid ledger, restart preserves
its existing boot deadline, wake reservations and session latch; it does not
necessarily start another hour. Initial adaptive reads are cache-only, at most
every ten minutes during that cooldown. Once it expires, stale mode defaults to
hourly cached checks. After a fresh charging report is observed, the following
eligible cycle may consider a wake, subject to report age and every other guard.
Python's immediate cache check can still veto it. Disk telemetry alone cannot
authorize startup, and a latched episode requires new fresh stopped evidence
before a later charging report can rearm it.

If cloud reports remain 60–90 minutes old, active mode cannot bootstrap under the
current policy. A fresh report arriving early in the cooldown may also expire
before it ends. The explicit-refresh observation establishes connectivity at that
moment, but does not establish that fresh reports arrive without a vehicle wake.
Therefore autonomous activation on this particular EV6 is **unproven and may be
rare or absent**. That is a practical limitation, not an API error.

## Recommendation and alternatives

Keep this installation cache-only with adaptive disabled. Use honest historical
status and the new diagnostics to assess whether independent fresh reports occur.
Do not enlarge the 20-minute safety window, reuse retrieval time as vehicle time,
reset budgets on restart or periodically issue a bootstrap wake. Those approaches
can turn stale charging into repeated vehicle contact and risk the 12V battery.

A future separately approved trial could use an independently delivered, trusted,
fresh, timestamped charging/plugged signal, but it must be corroborated by current
Kia telemetry before permitting a vehicle wake under the current design. External
charger status alone cannot prove the Kia report is current or override a session
latch. A user-authorized one-off refresh remains a separate operational decision;
this PR adds no button, command or allowance. If cache-only telemetry never
becomes fresh enough, accept passive operation unless a separate design review
explicitly approves a tightly bounded bootstrap policy and its battery risks.

## Required evidence before any future policy change

1. In a separately authorized observation window, record only report age, unchanged
   report counts, charging category and guard decisions across charge start/stop,
   driving and normal app use. Keep credentials, VIN and coordinates private.
   Confirm observation introduces no explicit wakes and stays within cloud limits.
2. Extend mock-clock tests across unknown vs persisted budgets, fresh evidence near
   cooldown expiry, 60–90 minute cache lag, sampling between fresh publications,
   missing/future/regressing timestamps and disagreeing charger/Kia signals.
3. Preserve hourly cloud and wake limits, concurrent-process exclusion, session
   latch and continuous-active cap through restart, network/auth failures, hung
   bridges and unchanged live responses. Require fresh stopped evidence to rearm.
4. Any future real-vehicle pilot requires separate approval, one active mirror,
   a finite observation window, explicit wake accounting and a stop criterion for
   12V decline, stale data, errors or repeated reports. No such pilot was run here.

The existing mock suites already pin stale refusal, cooldowns, persistent budgets,
Python preflight and episode latching. This PR adds presentation and diagnostic
regressions; it does not claim that mocked success predicts Kia's real cache cadence.
