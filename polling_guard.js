"use strict";
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const AP = require('./adaptive_polling');
const HOUR = 3600000;
const MIN_INTERVAL = 300000;
function bounded(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}
function limits(config = {}) {
  return { cycles: bounded(config.maxRequestsPerHour, 12, 1, 24),
    cloud: bounded(config.maxCloudRequestsPerHour, 60, 1, 120),
    interval: MIN_INTERVAL };
}
function sessionKey(key) { return crypto.createHash('sha256').update(key).digest('hex'); }
function acquire(cacheDir, key, account, config, now = Date.now()) {
  fs.mkdirSync(cacheDir, {recursive:true, mode:0o700});
  const file = path.join(cacheDir, 'polling-' + sessionKey(key) + '.json');
  const lock = file + '.lock';
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (_) { return { allowed:false, delay:60000, reason:'account request in progress or guard unavailable' }; }
  let closed = false;
  const release = () => { if (!closed) { closed=true; fs.closeSync(fd); fs.unlinkSync(lock); } };
  const save = () => {
    for (const [key, policy] of account.vehicles) {
      account.sessions[sessionKey(key)] = {started:policy.started, blocked:policy.blocked, highWater:Number.isFinite(policy.highWater)?policy.highWater:null};
    }
    const disk = {version:1,bootUntil:account.bootUntil,times:account.times,
      reqTimes:account.reqTimes,nextAt:account.nextAt,backoffUntil:account.backoffUntil,
      failures:account.failures,sessions:account.sessions};
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp,JSON.stringify(disk),{mode:0o600});
    fs.chmodSync(tmp,0o600); fs.renameSync(tmp,file);
  };
  try {
    let disk;
    try { disk=JSON.parse(fs.readFileSync(file,'utf8')); }
    catch(e) { if(e.code!=='ENOENT') account.backoffUntil=now+HOUR; }
    const valid = disk && disk.version===1 && ['bootUntil','nextAt','backoffUntil','failures'].every(k=>Number.isFinite(disk[k])&&disk[k]>=0) &&
      ['times','reqTimes'].every(k=>Array.isArray(disk[k])&&disk[k].every(t=>Number.isFinite(t)&&t>=0)) && disk.sessions && typeof disk.sessions==='object' && !Array.isArray(disk.sessions);
    if(valid) {
      for(const k of ["bootUntil","times","reqTimes","nextAt","backoffUntil","failures","sessions"]) account[k]=disk[k];
    }
    else {
      Object.assign(account,{bootUntil:now+HOUR,times:[],reqTimes:[],nextAt:0,
        backoffUntil:disk?now+HOUR:account.backoffUntil||0,failures:0,sessions:{}});
    }
    for (const [key, policy] of account.vehicles) restore(policy,key);
    account.reqTimes=account.reqTimes.filter(t=>now-t<HOUR);
    account.times=account.times.filter(t=>now-t<HOUR);
    const c=limits(config);
    const due=Math.max(account.nextAt,account.backoffUntil);
    let delay=due-now, reason='minimum interval / API backoff';
    if(account.reqTimes.length>=c.cycles) {
      delay=Math.max(delay,HOUR-(now-account.reqTimes[0])+1000); reason='account cloud-cycle hourly limit';
    }
    if(delay>0) { save(); release(); return {allowed:false,delay,reason}; }
    account.reqTimes.push(now); account.nextAt=now+c.interval;
    save();
    return {allowed:true,save,release,limits:c};
  } catch(e) { release(); return {allowed:false,delay:HOUR,reason:'account guard storage unavailable'}; }
}
function restore(policy,key) {
  const saved=policy.account.sessions && policy.account.sessions[sessionKey(key)];
  if(!saved) return;
  if((saved.started===null||Number.isFinite(saved.started)) && typeof saved.blocked==='boolean' &&
      (saved.highWater===null||Number.isFinite(saved.highWater))) {
    policy.started=saved.started; policy.blocked=saved.blocked;
    policy.highWater=saved.highWater===null?NaN:saved.highWater;
  } else policy.blocked=true;
}
module.exports={limits,MIN_INTERVAL,acquire,restore};
