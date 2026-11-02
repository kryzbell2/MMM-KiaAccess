#!/usr/bin/env python3
"""Explicit enrollment from a private server profile; never place secrets in argv."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def load_profile(file, name, web_root=None):
    p=Path(file).resolve()
    root=Path(web_root).resolve() if web_root else Path(__file__).resolve().parents[1].parent
    if root==p or root in p.parents:
        raise ValueError('profile must be outside MagicMirror served tree')
    for candidate in (p.parent/'state',p.parent/'state'/'cache'):
        if candidate.is_symlink(): raise ValueError('state symlinks are not supported')
    state=(p.parent/'state').resolve()
    if root==state or root in state.parents: raise ValueError('state must be outside served tree')
    parent=p.parent.stat()
    if os.name!='nt' and (parent.st_mode&0o077 or parent.st_uid!=os.getuid()): raise ValueError('private directory required')
    st=p.stat()
    if st.st_size>65536 or (os.name!='nt' and (st.st_mode&0o077 or st.st_uid!=os.getuid())):
        raise ValueError('profile must be owner-only')
    c=json.loads(p.read_text(encoding='utf-8'))['profiles'][name]
    if not isinstance(c,dict) or not isinstance(c.get('username'),str) or not isinstance(c.get('password'),str):
        raise ValueError('invalid profile')
    job={k:c[k] for k in ('username','password','pin','region','brand') if k in c}
    job['stateDirectory']=str(state)
    return job


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile',required=True)
    args=parser.parse_args()
    try:
        file=os.environ['MMM_KIA_SECRETS_FILE']
        if not Path(file).is_absolute(): raise ValueError('absolute path required')
        job=load_profile(file,args.profile)
    except (OSError,ValueError,KeyError,TypeError):
        print('Private enrollment profile unavailable; no authentication attempted',file=sys.stderr)
        return 1
    Path(job["stateDirectory"]).mkdir(mode=0o700,parents=True,exist_ok=True)
    env=dict(os.environ,KIA_JOB=json.dumps(job))
    return subprocess.call([sys.executable,str(Path(__file__).with_name('enroll.py'))],env=env)


if __name__=='__main__':
    raise SystemExit(main())
