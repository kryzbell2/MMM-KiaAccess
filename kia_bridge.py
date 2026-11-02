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


def main():
    try:
        job = json.load(sys.stdin)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"bad job payload: {exc}"}))
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
    except cloud_budget.BudgetExceeded:
        print(json.dumps({"ok": False, "error": "cloud request limit or guard unavailable; passive backoff"}))
    except kia_client.OtpRequired as exc:
        print(json.dumps({"ok": False, "error": "Kia enrollment required; use the local enrollment workflow"}))
    except kia_client.ClientError as exc:
        print(json.dumps({"ok": False, "error": "Kia request failed; passive backoff"}))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"Kia request failed ({type(exc).__name__}); passive backoff"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
