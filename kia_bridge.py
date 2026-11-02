#!/usr/bin/env python3
"""Bridge between MMM-KiaAccess (Node) and hyundai_kia_connect_api (Python).

Reads a JSON job on stdin:
    {"username": "...", "password": "...", "pin": "...",
     "brand": "KIA", "region": "USA", "vin": "", "refresh": true}

  ... "vin": "" with "allVehicles": true returns every vehicle on the
  account instead of erroring on the ambiguity (used by MM's rotate-within-
  one-module feature; every other caller leaves this unset/false):
    {"username": "...", ..., "vin": "", "allVehicles": true}

  ... or a control job (used by the Home Assistant integration, not MM):
    {"command": "lock", ...credentials...}
    {"command": "start_climate", "options": {"set_temp": 21}, ...}

Writes a JSON result on stdout:
    {"ok": true, "vehicles": [ {<flattened vehicle attrs>} , ... ]}
    {"ok": true, "command": "lock", "vehicleId": "..."}
    {"ok": false, "error": "..."}

The real work lives in kia_client.py, shared with the HA integration. Why a
Python bridge instead of the Node `bluelinky` library: Kia USA sits behind
Cloudflare bot protection that blocks bluelinky's American controller (HTTP
403). hyundai_kia_connect_api carries the Cloudflare handling and is actively
maintained (it powers the Home Assistant Kia/Hyundai integration).
"""

import json
import sys

import os
import cloud_budget
import kia_client


def failure_kind(error):
    """Public classification only; never return exception text or response data."""
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        names = {cls.__name__.lower() for cls in type(error).__mro__}
        if isinstance(error, cloud_budget.BudgetExceeded):
            return "rate_limit" if "hourly limit" in str(error) else "processing"
        if any("authentication" in name or "otp" in name or name == "pinmissingerror" for name in names):
            return "authentication"
        if any("timeout" in name or "connection" in name for name in names):
            return "network"
        if isinstance(error, kia_client.ClientError):
            text = str(error)
            if text.startswith("cooling down after "):
                return "authentication"
            if text.startswith("live wake-up timed out"):
                return "network"
        if isinstance(error, (ValueError, TypeError)):
            return "processing"
        error = error.__cause__ or error.__context__
    return "api"


def main():
    try:
        job = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": "bad job payload", "errorKind": "processing"}))
        return 0

    try:
        if job.get("command"):
            result = kia_client.run_command(job)
        else:
            protection = job.get("requestProtection")
            if protection:
                ledger = os.path.join(job.get("stateDirectory") or kia_client._HERE, "cache", "request-budget-" + kia_client._job_account_hash(job) + ".json")
                budget = cloud_budget.Budget(ledger, protection.get("maxCloudRequestsPerHour", 60))
                # Reserve each actual per-vehicle wake, including legacy all-
                # vehicle jobs, before handing it to the library.
                job["_wakeBudget"] = budget
                with cloud_budget.protect_http(budget):
                    result = kia_client.fetch(job)
            else:
                result = kia_client.fetch(job)
            # the raw token is only for in-process HA callers — never expose it
            # to the Node side (it would reach the frontend / MQTT)
            if isinstance(result.get("meta"), dict):
                result["meta"].pop("token", None)
        print(json.dumps(result))
    except cloud_budget.BudgetExceeded as exc:
        print(json.dumps({"ok": False, "error": "cloud request limit or guard unavailable; passive backoff", "errorKind": failure_kind(exc)}))
    except kia_client.OtpRequired as exc:
        print(json.dumps({"ok": False, "error": "Kia enrollment required; use the local enrollment workflow", "errorKind": "authentication"}))
    except kia_client.ClientError as exc:
        print(json.dumps({"ok": False, "error": "Kia request failed; passive backoff", "errorKind": failure_kind(exc)}))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": "Kia request failed; passive backoff", "errorKind": failure_kind(exc)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
