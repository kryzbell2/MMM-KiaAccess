const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const PG=require('../polling_guard'),AP=require('../adaptive_polling');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guard-test-'));
const now=Date.now(),hour=3600000;
assert.equal(AP.options().enabled,false);
for(const enabled of [false,'true',1,null,undefined]) assert.equal(AP.options({enabled}).enabled,false);
assert.equal(AP.options({enabled:true}).enabled,true);
for(const bad of [0,-1,NaN,Infinity,'2',{},null]) {
 assert.equal(PG.limits({maxRequestsPerHour:bad}).cycles,12);
 assert.equal(PG.limits({maxCloudRequestsPerHour:bad}).cloud,60);
}
assert.equal(AP.options({chargingInterval:1}).chargingInterval,600000);
assert.equal(PG.limits({maxRequestsPerHour:999}).cycles,24);
function acquire(account,key='test',time=now,config={}) {return PG.acquire(dir,key,account,config,time);}
const first=AP.accountBudget(now);
let lease=acquire(first);assert(lease.allowed);
assert.equal(acquire(AP.accountBudget(now)).allowed,false); // another process/account scope
first.times.push(now);first.nextAt=now+300000;lease.save();lease.release();
const restarted=AP.accountBudget(now+1);
assert.equal(acquire(restarted,'test',now+1).allowed,false);
assert.deepEqual(restarted.times,[now]);
assert.equal(restarted.bootUntil,now+hour); // restart does not extend or clear initial cooldown
lease=acquire(restarted,'test',now+300001);assert(lease.allowed);lease.release();
const capped=AP.accountBudget(now);
lease=acquire(capped,'capped',now,{maxRequestsPerHour:1});assert(lease.allowed);lease.release();
assert.equal(acquire(AP.accountBudget(now),'capped',now+300001,{maxRequestsPerHour:1}).allowed,false);
// Restored session remains latched until a newer stopped report, not merely charging.
const session=AP.accountBudget(now),car=new AP.Poller(now,session);
car.started=now;car.blocked=true;car.highWater=now;session.vehicles.set('mock-car',car);
lease=acquire(session,'sessions');lease.save();lease.release();
const restored=AP.accountBudget(now+hour);
lease=acquire(restored,'sessions',now+hour+1);assert(lease.allowed);
const newCar=new AP.Poller(now+hour,restored);PG.restore(newCar,'mock-car');
assert(newCar.blocked);assert.equal(newCar.started,now);lease.release();
// Corrupted guard fails closed for an hour; it is never treated as a fresh unlimited account.
const beforeFiles=new Set(fs.readdirSync(dir));
lease=acquire(AP.accountBudget(now),'corruption',now);assert(lease.allowed);lease.release();
const file=fs.readdirSync(dir).find(f=>!beforeFiles.has(f)&&f.endsWith('.json'));
fs.writeFileSync(path.join(dir,file),'broken');
assert.equal(acquire(AP.accountBudget(now),'corruption',now+hour+1).allowed,false);
// Charging can activate from independent fresh cloud evidence after cooldown,
// including a restart during that cooldown; stale evidence never activates.
const c=AP.options({enabled:true}),warm=AP.accountBudget(now),p=new AP.Poller(now,warm);
function v(t,charge=true){return {last_updated_at:new Date(t).toISOString(),ev_battery_is_charging:charge,ev_battery_is_plugged_in:2};}
assert.equal(p.observe(v(now),c,now),600000);
for(let i=1;i<=5;i++){p.observe(v(now+i*600000),c,now+i*600000);assert.equal(p.reserve(c,now+i*600000).live,false);}
p.observe(v(now+hour),c,now+hour);assert(p.reserve(c,now+hour).live);
assert.equal(p.reserve(c,now+hour+c.statusMaxAge+1).live,false);
// A stale 12V value stays visible but cannot trigger a fresh low/drain warning.
const S=require('../core/state'),C=require('../core/conditions');
const stale=S.buildState({'vehicle.car_battery_percentage':10,'vehicle.last_updated_at':new Date(now-hour).toISOString()});
assert.equal(stale.car12vPct,10);assert.equal(stale.battery12vFresh,false);
assert(C.evaluate(stale).conditions.filter(c=>c.reason.startsWith('battery_12v')).every(c=>c.active!==true));
const fresh=S.buildState({'vehicle.car_battery_percentage':10,'vehicle.last_updated_at':new Date().toISOString()});
assert(C.evaluate(fresh).conditions.some(c=>c.reason==='battery_12v_low'&&c.active));
console.log('polling guard, opt-in, restart, freshness and configuration tests passed');

const defaults=require('./require-mm-module')().defaults;
assert.equal(defaults.adaptivePolling.enabled,false);assert.equal(defaults.refresh,false);
const cp=require('child_process');
for(const name of ['authstate-a.json','token-a.json','server-secrets.json','.env','cache/polling-a.json','backups/config.js']) {
 assert.equal(cp.spawnSync('git',['check-ignore','--no-index','-q',name],{cwd:path.join(__dirname,'..')}).status,0);
}
