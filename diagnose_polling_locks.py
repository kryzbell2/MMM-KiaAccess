#!/usr/bin/env python3
"""Read-only diagnostics for MMM-KiaAccess polling/request lock files."""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import stat
import time

LOCK_NAME = re.compile(r"(?:polling-[0-9a-f]{64}|request-budget-[0-9a-f]{16})\.json\.lock\Z")
RECOVERY = [
    "This command only inspects filesystem metadata. It does not read lock/ledger contents, contact Kia, or modify files.",
    "Current lock files record no owner PID. Age alone cannot establish that a lock is orphaned.",
    "Identify and stop the actual MagicMirror process with its existing process manager; verify that all associated kia_bridge.py processes have ended.",
    "Re-run this diagnostic after stopping them. Preserve private logs and budget JSON files; inspect any remaining lock locally.",
    "Only an operator who has confirmed no request is running may manually remove that specific orphan .lock file. If ownership is uncertain, leave it in place.",
    "Never delete/reset budget JSON, token files, or history to bypass limits. Restart only in the existing cached-only configuration; do not force a vehicle refresh to test recovery.",
]


def default_directories(env=None, module_dir=None):
    env = os.environ if env is None else env
    module_dir = Path(__file__).resolve().parent if module_dir is None else Path(module_dir)
    roots = [module_dir / 'cache']
    secret_file = env.get('MMM_KIA_SECRETS_FILE')
    if secret_file:
        p = Path(secret_file).expanduser()
        if not p.is_absolute():
            raise ValueError('MMM_KIA_SECRETS_FILE must be absolute; use --cache-dir to inspect a specific location')
        # Resolve only the filename location, not its contents. Profiles place
        # their shared state/cache beside this file, regardless of profile name.
        roots.append(p.resolve().parent / 'state' / 'cache')
    return list(dict.fromkeys(roots))


def scan_directory(directory, older_than_seconds, now=None):
    now = time.time() if now is None else now
    directory = Path(directory).absolute()
    result = {'directory': str(directory), 'status': 'present', 'locks': []}
    try:
        info = directory.lstat()
        if stat.S_ISLNK(info.st_mode):
            result['status'] = 'symlink-directory-not-inspected'
            return result
        if not stat.S_ISDIR(info.st_mode):
            result['status'] = 'not-a-directory'
            return result
        entries = sorted(directory.iterdir(), key=lambda p: p.name)
    except FileNotFoundError:
        result['status'] = 'missing'
        return result
    except OSError:
        result['status'] = 'metadata-unavailable'
        return result
    for entry in entries:
        if not LOCK_NAME.fullmatch(entry.name):
            continue
        row = {'path': str(entry), 'status': 'owner-unknown', 'orphan_candidate': False}
        try:
            info = entry.lstat()
            if stat.S_ISLNK(info.st_mode):
                row['status'] = 'symlink-lock-not-inspected'
            elif not stat.S_ISREG(info.st_mode):
                row['status'] = 'not-a-regular-lock-file'
            else:
                age = now - info.st_mtime
                row['age_seconds'] = round(age, 1)
                row['modified_utc'] = datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat()
                if age < 0:
                    row['status'] = 'future-mtime-owner-unknown'
                elif age >= older_than_seconds:
                    row['status'] = 'old-lock-owner-unknown'
                    row['orphan_candidate'] = True
                else:
                    row['status'] = 'recent-lock-owner-unknown'
        except FileNotFoundError:
            row['status'] = 'disappeared-during-scan'
        except (OSError, ValueError, OverflowError):
            row['status'] = 'metadata-unavailable'
        result['locks'].append(row)
    return result


def positive_minutes(value):
    minutes = float(value)
    if not math.isfinite(minutes) or minutes <= 0:
        raise argparse.ArgumentTypeError('minutes must be positive and finite')
    return minutes


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', action='append', type=Path,
                        help='inspect only this cache directory; repeat for multiple locations')
    parser.add_argument('--older-than-minutes', type=positive_minutes, default=15,
                        help='flag old locks as candidates, never proof of orphaning (default: 15)')
    parser.add_argument('--json', action='store_true', help='emit metadata and recovery instructions as JSON')
    args = parser.parse_args(argv)
    try:
        roots = args.cache_dir or default_directories()
    except (ValueError, OSError):
        parser.error('cannot determine private cache location; supply --cache-dir explicitly')
    directories = [scan_directory(p, args.older_than_minutes * 60) for p in roots]
    report = {'read_only': True, 'snapshot_only': True, 'directories': directories, 'recovery': RECOVERY}
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for result in directories:
            print('Directory:', result['directory'], '(' + result['status'] + ')')
            if result['status'] == 'present' and not result['locks']:
                print('  No recognized polling locks present at this snapshot.')
            for lock in result['locks']:
                age = ' age=' + str(lock['age_seconds']) + 's' if 'age_seconds' in lock else ''
                print('  ' + lock['path'] + ': ' + lock['status'] + age)
        print('\nRecovery guidance (no actions performed):')
        for text in RECOVERY:
            print('- ' + text)
    incomplete = {'symlink-directory-not-inspected', 'not-a-directory', 'metadata-unavailable'}
    return 1 if any(d['status'] in incomplete or any(lock['status'] in
        {'symlink-lock-not-inspected', 'not-a-regular-lock-file', 'metadata-unavailable'}
        for lock in d['locks']) for d in directories) else 0


if __name__ == '__main__':
    raise SystemExit(main())
