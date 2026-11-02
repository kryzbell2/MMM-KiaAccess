# Server-only Kia credential profiles

This security change is reviewed separately and stacked on the polling-safety PR.
It does not migrate any installation, enroll an account, rewrite config.js or
invalidate a token automatically. The explicit migration helper moves existing
state only when the operator requests it after stopping the module. Keep both mirrors unchanged during review.

## Credential lifecycle and trust boundary

Legacy MagicMirror config.js includes account fields which MagicMirror sends to
its browser. The module then includes them in KIA_FETCH socket messages. Removing
passwords from the module's outbound message alone cannot undo the core config
exposure. This repository cannot secure secrets left in a browser-served config.

The new path is browser **profile name only** -> Node helper -> Python stdin.
Set the server process environment variable `MMM_KIA_SECRETS_FILE` to an absolute
private JSON file path **outside MagicMirror's served tree and launch directory**.
For example, use `$HOME/.config/MMM-KiaAccess/accounts.local.json`, not a file in
modules/, config/, public/, or the repository. Do not mount that private directory
through a web server or proxy. The loader rejects served-tree paths (including
symlinks into them), malformed profiles and, on Unix, non-owner/group-readable
files. On Windows, keep the file under a user-only ACL; POSIX mode checks are not
an ACL substitute. Custom web aliases or an incorrectly configured reverse proxy
are outside this module's control.

When the environment variable is present, Node refuses all legacy credential
messages and all unknown profiles, including after a file-read error. Client
credentials, executable paths, live intent, rate limits, vehicle choice and URLs
cannot override the private profile. Profiles currently support one Kia vehicle
per public module block; rotation and Home Assistant-source credential profiles
are not implemented. Existing legacy configurations remain supported if the
server-profile environment variable is absent, with their existing browser-secret
exposure documented rather than silently migrated.

The helper retains the original internal account/vehicle identity and token/cache
basenames. Secure mode stores all new token, authentication cooldown, HTTP budget
and telemetry cache files under `state/` next to the private account file, outside
the served tree. Existing state must be moved explicitly with the helper below;
missing private tokens fail before any API login. Public socket identifiers use `profile:<name>|auto` and omit the
account email. Token contents and account-scoped basenames remain unchanged; their directory
changes only through explicit migration/enrollment. Tokens are never sent to the browser. Public payloads recursively remove authentication fields and
redact matching credential values; arbitrary warning/error text and the raw
vehicle.data API envelope are withheld. Standard sensor attributes remain available.

Secure-profile mode refuses browser webhooks and parked-anchor cache writes.
Otherwise any socket client could forge a condition event or persist a fabricated
location. Basic dashboard telemetry, locking warnings, battery/range display and
in-browser condition notifications remain available. Restart-persistent parked
anchors and outbound webhooks require a future server-owned event evaluator;
location map requests are also excluded from this initial secure profile schema.
Do not put MQTT credentials or API keys in the public config; any supported
backend exporter/MQTT settings belong only in the trusted server file.

This does **not** authenticate MagicMirror's browser or encrypt telemetry visible
to that browser. A client that knows a profile name can request a permitted cached
read, subject to server budgets. Keep MagicMirror bound to loopback/trusted local
clients or behind an authenticated proxy. Third-party modules running with the
same OS user can read that user's files. Do not enable raw API/debug credential
logging. These limits cannot be removed solely inside this module.

## Future migration, only after approval

These steps are documentation, not actions performed on a Pi. Discover the actual
module directory and process manager as described in README. As the MagicMirror
user, create the private copy first, then edit only that copy:

```bash
umask 077
mkdir -p "$HOME/.config/MMM-KiaAccess"
chmod 700 "$HOME/.config/MMM-KiaAccess"
# MODULE is the discovered checkout path; do not edit the tracked example.
cp "$MODULE/examples/server-profiles.example.json" "$HOME/.config/MMM-KiaAccess/accounts.local.json"
chmod 600 "$HOME/.config/MMM-KiaAccess/accounts.local.json"
nano "$HOME/.config/MMM-KiaAccess/accounts.local.json"
export MMM_KIA_SECRETS_FILE="$HOME/.config/MMM-KiaAccess/accounts.local.json"
```

Privately enter the existing credentials in the private copy. Keep `refresh:false`,
`forceRefreshTimeout:0` and `adaptivePolling.enabled:false`. No re-enrollment is
needed if the existing token is valid; preserve the same username, brand and region.
Stop the actual MagicMirror process and any bridge first. Back up private config
and runtime files outside the served tree. With the server environment set, run:

```bash
cd "$MODULE"
./venv/bin/python3 migrate_server_state.py --profile bluebell
# Review locally. The first invocation is a dry run and makes no API calls.
./venv/bin/python3 migrate_server_state.py --profile bluebell --apply --confirmed-stopped
```

The explicit move preserves token contents, account IDs, history and budgets. It
refuses existing private destinations and outstanding request locks; it does not
overwrite another enrollment or silently delete budget history. Stop and inspect
any conflict locally. If interrupted, preserve both copies and finish recovery
before restarting. It supports account-scoped token files, not untagged ancient
single-account token.json. No network is contacted by the migration helper.
Audit the served tree for other old secrets/backups: `.gitignore` does not prevent
HTTP access. The helper moves only the selected account's token/auth files and
shared module-cache files, not unrelated config backups or other accounts. Remove
any remaining secret-bearing served files to private storage before reopening
network access. Do not leave a private backup of config.js in a public directory.
Use the complete public block in `examples/bluebell.server.config.example.js` to
replace the old Kia block. **Remove** username/password/PIN/token fields entirely
from public config.js, including environment expressions that resolve to secrets.
Do not reference the private JSON from config.js: MagicMirror may serialize the
result to clients. This server-profile mode must be selected by the Node process
environment, never a filename supplied by the browser.

Persist the environment variable in the existing service's configuration. For PM2,
put the absolute filename in its existing environment settings and restart the
actual MagicMirror process with `--update-env`; for systemd use an `Environment=`
override with an absolute filename. Discover names rather than assuming a service
or directory. Validate config syntax and restart only after approval. A wrong file
or profile should yield a generic disabled request, never a fallback login.

If Kia explicitly requires enrollment later, run this from the module directory
with the same server environment. It passes credentials only to the child process
in its environment, retains the existing enrollment code/OTP prompts, and never
puts credentials in command arguments:

```bash
./venv/bin/python3 enroll_server.py --profile bluebell
```

Enrollment is a separate, explicit operation; tests never execute it against Kia.
OTP codes stay in the user's terminal. Enrollment subprocess environment variables
remain readable to sufficiently privileged local processes; trust/secure the OS
account. No frontend or GitHub upload is involved.

## Verify without revealing secrets

Confirm cached retrieval and rate/backoff diagnostics in private runtime logs.
Inspect browser network traffic locally: KIA_FETCH contains only
`{"credentialProfile":"bluebell"}`, and public identifiers start with
`profile:bluebell|auto`. Verify there are no account/password/PIN/token fields in
config responses or module socket data. Never paste those traces into GitHub.
Malformed profile, browser override and token-redaction cases are covered by
mocked CI tests. No physical mirror or Kia API is contacted by those tests.
