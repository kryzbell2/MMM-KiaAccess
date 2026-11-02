#!/usr/bin/env python3
"""Explicitly move existing Kia state out of the served module tree. Dry run by default."""
import argparse
import os
from pathlib import Path
import shutil
import sys
import kia_client
from enroll_server import load_profile


def migrate(source, job, apply=False):
    source=Path(source).resolve(); target=Path(job['stateDirectory']).resolve()
    if source==target or source in target.parents: raise ValueError('state target must be outside module')
    account=kia_client._job_account_hash(job)
    token=source/f'token-{account}.json'
    if not token.is_file(): raise ValueError('existing account token not found; no files moved')
    pairs=[]
    cache=source/'cache'
    if cache.is_symlink() or (target/'cache').is_symlink(): raise ValueError('cache symlinks are not supported')
    if cache.exists():
        if any(cache.glob('*.lock')): raise ValueError('inspect request locks after stopping all processes')
        pairs += [(p,target/'cache'/p.name) for p in cache.iterdir() if p.is_file()]
    for pattern in (f'authstate-{account}.json*',f'token-{account}.json*'):
        pairs += [(p,target/p.name) for p in source.glob(pattern) if p.is_file() and p!=token]
    pairs.append((token,target/token.name)) # token becomes usable only after budgets/history moved
    if any(src.is_symlink() for src,_ in pairs): raise ValueError('state symlinks are not supported')
    if any(dst.exists() for _,dst in pairs): raise ValueError('private state already exists; refusing overwrite')
    if apply:
        target.mkdir(mode=0o700,parents=True,exist_ok=True);target.chmod(0o700)
        for src,dst in pairs:
            dst.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            shutil.move(str(src),str(dst));dst.chmod(0o600)
    return len(pairs)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--profile',required=True)
    p.add_argument('--apply',action='store_true')
    p.add_argument('--confirmed-stopped',action='store_true')
    args=p.parse_args()
    if args.apply and not args.confirmed_stopped:
        p.error('--apply requires --confirmed-stopped; stop all module/bridge processes first')
    try:
        job=load_profile(os.environ['MMM_KIA_SECRETS_FILE'],args.profile)
        count=migrate(Path(__file__).resolve().parent,job,args.apply)
    except (OSError,ValueError,KeyError,TypeError):
        print('State migration unavailable/incomplete; inspect private files locally. No authentication attempted.',file=sys.stderr)
        return 1
    print(('Moved ' if args.apply else 'Would move ')+str(count)+' private state files; no API requests made')
    return 0


if __name__=='__main__':raise SystemExit(main())
