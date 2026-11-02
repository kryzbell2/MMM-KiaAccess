# Blue Beauty: two MagicMirror Raspberry Pis

The complete [configuration example](../examples/bluebell.config.example.js)
reproduces the EV6 dashboard confirmed working in the October 31, 2026 chat:
traction battery, range in miles, charging/plug state, and 12V percentage;
320px layout, 190px car, no map, and no service-due alert.
The 12V value is reported charge percentage, not a battery health test.

The example explicitly disables adaptive polling and requests cached data every 30 minutes (`1800000` milliseconds),
with both forced-refresh controls disabled. This is not a promise that Kia
will never wake the vehicle. The vehicle-reported timestamp can remain stale
across polls. Two independently enrolled mirrors each poll every 30 minutes,
so together they make approximately four scheduled requests per hour, plus
startup/retry activity. Do not reduce the interval to make stale data look fresh.

## Preserve the first Pi

Do not reinstall, re-enroll, overwrite config.js, or pull new upstream code on
the working Pi just to adopt a fork. First record its module commit and clean/
dirty status. Keep credentials, tokens and cache on that Pi. Back up privately,
outside any Git checkout, with owner-only access. Never paste private config,
token files, cache contents, VINs or locations into an issue or commit.

After the fork is published, inspect `git remote -v` in the module directory.
If `origin` currently points to Legal-Copy7045 and no `upstream` remote exists,
these commands preserve that source while connecting your fork:

```bash
cd ~/MagicMirror/modules/MMM-KiaAccess
git status --short
git rev-parse HEAD
git remote rename origin upstream
git remote add origin https://github.com/kryzbell2/MMM-KiaAccess.git
git fetch origin
```

If the remotes differ, stop and inspect rather than overwriting them. These
commands do not change running files. Leave the working configuration in place.
Review any later upgrade against its recorded commit before applying it.

## Install on the second Pi (after publication)

Use an interactive terminal logged in as the user that runs MagicMirror.
These steps assume MagicMirror is already installed in `~/MagicMirror` and
that the second Pi does not already have an MMM-KiaAccess directory.

```bash
cd ~/MagicMirror/modules
git clone https://github.com/kryzbell2/MMM-KiaAccess.git
cd MMM-KiaAccess
git remote add upstream https://github.com/Legal-Copy7045/MMM-KiaAccess.git
npm install
./venv/bin/python3 --version
```

Installation provisions Python and dependencies; confirm Python is at least
3.12. If setup fails, follow the Python installation section in README before
continuing. Do not copy a virtual environment from the first Pi.

### Enroll independently

Run this complete block from the module directory. Credentials are requested
interactively so they do not appear in shell history or command arguments.
It passes them to upstream enrollment only in the child process environment.
Complete Kia's SMS/email code prompts on this Pi. Do not copy the first Pi's
token files. Enrollment may affect account sessions; check the first mirror
afterward and re-enroll there only if Kia actually requires it.

```bash
umask 077
./venv/bin/python3 - <<'PY'
import getpass
import json
import os
import subprocess
import sys
with open('/dev/tty', 'r+') as terminal:
    terminal.write('Kia email: ')
    terminal.flush()
    username = terminal.readline().strip()
password = getpass.getpass('Kia password: ')
pin = getpass.getpass('Kia PIN (Enter if unused): ')
job = dict(username=username, password=password, pin=pin, region='USA', brand='KIA')
env = dict(os.environ, KIA_JOB=json.dumps(job))
with open('/dev/tty', 'r') as terminal:
    result = subprocess.run([sys.executable, 'enroll.py'], env=env, stdin=terminal)
raise SystemExit(result.returncode)
PY
```

### Configure and verify

Privately back up `~/MagicMirror/config/config.js` outside Git. Open the example
and copy the complete object from `{` through the matching `}` into the
`modules: [...]` array in that config. The examples have no wrapper; paste the complete bare object directly.
Add a comma between module objects. Replace the two credential placeholders
only in the Pi's private config.js; keep the blank PIN unless your account uses one.
If replacing an existing Kia block, replace the whole block, not individual lines.

```bash
chmod 600 ~/MagicMirror/config/config.js
cd ~/MagicMirror
npm run config:check
```

Restart with your existing MagicMirror startup method only after validation
passes. Check battery, miles, 12V percentage, reported time, no map, and no
service warning. Confirm the first mirror still works. No vehicle login or live
dashboard validation is performed by checking this example on a development PC.

## Keep private data out of Git

The ignore rules cover config.js and backups, secrets, `.env`, token JSON and
temporary token files, `cache/` (upstream stores runtime history here), runtime,
history and backup directories, logs, and local databases. Do not put private
exports under another name or use `git add -f`. Ignore rules cannot remove
already tracked secrets: inspect `git ls-files` and staged changes before every
publication. Stage only named example/documentation files, never `git add .`
on a deployed Pi. If credentials were ever committed, revoke them and resolve
the history exposure before publishing.
