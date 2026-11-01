const assert = require("assert");
const { Poller, options, mode } = require("../adaptive_polling");
const c = options(), boot = Date.now(), now = boot + 3600001;
const vehicle = (charging, plug, t = now) => ({ ev_battery_is_charging: charging,
  ev_battery_is_plugged_in: plug, last_updated_at: new Date(t).toISOString() });
const p = new Poller(boot);
assert.equal(p.reserve(c, now).live, false); // startup
for (const [charge, plug, expected] of [[false, 0, "idle"], [false, 2, "plugged"], [true, 2, "charging"], [true, 0, "idle"], [null, 2, "stale"]]) {
  assert.equal(mode(vehicle(charge, plug), c, now), expected);
}
p.observe(vehicle(true, 2), c, now);
assert.equal(p.reserve(c, boot + 100).live, false); // restart cooldown
assert.equal(p.reserve(c, now).live, true);
p.observe(vehicle(true, 2), c, now, true); // unchanged live response
assert.equal(p.reserve(c, now + 1).live, false);
p.observe(vehicle(true, 2, now + 10), c, now + 10); // charging alone cannot rearm
assert.equal(p.reserve(c, now + 10).live, false);
p.observe(vehicle(false, 2, now + 20), c, now + 20);
assert.equal(p.reserve(c, now + 20).live, false);
p.observe(vehicle(false, 0, now + 30), c, now + 30);
assert.equal(p.mode, "idle");
p.observe(vehicle(true, 2, now + 40), c, now + 40);
assert.equal(p.reserve(c, now + 40).live, true);
assert.equal(p.reserve(c, now + c.statusMaxAge + 41).live, false);
const hourly = new Poller(boot); hourly.observe(vehicle(true, 2), c, now);
for (let i = 0; i < 6; i++) assert(hourly.reserve(c, now).live);
assert.equal(hourly.reserve(c, now).reason, "hourly live limit");
const continuous = new Poller(boot); continuous.started = now - 90 * 60000;
continuous.observe(vehicle(true, 2), c, now);
assert.equal(continuous.reserve(c, now).reason, "continuous active limit");
for (let i = 0; i < 4; i++) { p.fail(c, now); assert(p.blocked); assert(p.due >= now + c.staleInterval); }
assert.equal(p.reserve(c, now).live, false);
// Integration: mock spawn, never contact Kia. Account scopes share overlap guard.
const cp = require("child_process"), { EventEmitter } = require("events");
const original = cp.spawn; const jobs = [], children = [];
cp.spawn = () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdin.write = data => jobs.push(JSON.parse(data));
  child.stdin.end = () => {}; child.kill = () => {}; children.push(child); return child;
};
try {
  const { freshHelper, tmpCacheDir } = require("./fresh-node-helper");
  const h = freshHelper(tmpCacheDir("adaptive-"));
  const config = { username: "mock", region: "USA", brand: "KIA", adaptivePolling: c };
  h.handleFetch(config); h.handleFetch({ ...config, vin: "mock-other" });
  assert.equal(jobs.length, 1); assert.equal(jobs[0].refresh, false);
  children[0].emit("error", new Error("mock timeout"));
  assert(h.adaptive[h.identifierFor(config)].blocked);
  const legacy = { ...config, username: "legacy", refresh: true, adaptivePolling: { enabled: false }, forceRefreshTimeout: 45 };
  h.handleFetch(legacy); assert.equal(jobs[1].refresh, true); assert.equal(jobs[1].forceRefreshTimeout, 45);
  children[1].emit("error", new Error("mock auth"));

  // Exercise the real helper response path, cadence, active authorization and stop.
  const realNow = Date.now;
  let clock = now;
  Date.now = () => clock;
  try {
    const cfg = { ...config, username: "controlled" };
    const id = h.identifierFor(cfg), policy = h.adaptivePolicy(id, cfg);
    const finish = (v, live = false, meta = {}) => {
      const child = children[children.length - 1];
      child.stdout.emit("data", JSON.stringify({ ok: true, vehicles: [v], meta: { adaptiveLive: live, ...meta } }));
      child.emit("close", 0);
    };
    policy.account.bootUntil = clock - 1;
    h.handleFetch(cfg);
    assert.equal(jobs[jobs.length - 1].refresh, false);
    finish(vehicle(true, 2, clock));
    assert.equal(policy.due, clock + c.chargingInterval);
    const requests = jobs.length;
    h.handleFetch(cfg);
    assert.equal(jobs.length, requests); // UI/manual refresh cannot bypass cadence
    clock += c.chargingInterval;
    h.handleFetch(cfg);
    assert.equal(jobs[jobs.length - 1].refresh, true);
    finish(vehicle(false, 2, clock), true); // charging finishes during live call
    assert.equal(policy.mode, "plugged");
    assert.equal(policy.due, clock + c.pluggedInterval);
    clock += c.pluggedInterval;
    h.handleFetch(cfg);
    assert.equal(jobs[jobs.length - 1].refresh, false);
    const before = h.st(id).history.length;
    finish(vehicle(false, 2, clock - c.pluggedInterval));
    assert.equal(h.st(id).history.length, before); // unchanged report is not a new sample
    clock = policy.due;
    h.handleFetch(cfg);
    // A success payload missing the new bridge verification metadata is a failure.
    const child = children[children.length - 1];
    child.stdout.emit("data", JSON.stringify({ok:true,vehicles:[vehicle(true,2,clock)]}));
    child.emit("close",0);
    assert(policy.blocked);
    assert(policy.due >= clock + c.staleInterval);
    // A second configured scope cannot reset this episode or bypass its backoff.
    const other = {...cfg, vin:"other"};
    const otherPolicy = h.adaptivePolicy(h.identifierFor(other), other);
    assert.notEqual(policy, otherPolicy);
    assert.equal(policy.account, otherPolicy.account);
    h.handleFetch(other);
    assert.equal(jobs.length, requests + 3);
    const physical = { ...vehicle(true,2,clock), id: "mock-physical" };
    const autoPolicy = h.adaptivePolicy(id, cfg, physical);
    autoPolicy.blocked = true;
    autoPolicy.started = clock;
    const explicit = { ...cfg, vin: "mock-physical" };
    const sameCarPolicy = h.adaptivePolicy(h.identifierFor(explicit), explicit, physical);
    assert.equal(autoPolicy, sameCarPolicy);
    assert(sameCarPolicy.blocked);
    const differentCar = h.adaptivePolicy(h.identifierFor(other), other, {...physical,id:"other"});
    differentCar.observe(vehicle(false,2,clock+1),c,clock+1);
    assert(autoPolicy.blocked);
  } finally { Date.now = realNow; }
} finally { cp.spawn = original; }
console.log("adaptive polling tests passed");

// A regressing/missing/future report must not lower the rearm baseline.
for (const invalid of [vehicle(true, 2, now - 1000), {}, vehicle(true, 2, now + 60000)]) {
  const latch = new Poller(boot);
  latch.observe(vehicle(true, 2), c, now);
  assert(latch.reserve(c, now).live);
  latch.observe(invalid, c, now + 1, true);
  latch.observe(vehicle(false, 2, now - 500), c, now + 2);
  latch.observe(vehicle(true, 2, now + 3), c, now + 3);
  assert.equal(latch.reserve(c, now + 3).live, false);
  latch.observe(vehicle(false, 2, now + 4), c, now + 4);
  latch.observe(vehicle(true, 2, now + 5), c, now + 5);
  assert(latch.reserve(c, now + 5).live);
}
// A future report cannot become permission merely because wall time catches up.
const future = new Poller(boot);
future.observe(vehicle(true, 2, now + 1000), c, now);
assert.equal(future.reserve(c, now + 1000).live, false);
// Contradictory status under the same report timestamp is unverifiable.
const conflict = new Poller(boot);
conflict.observe(vehicle(false, 2), c, now);
conflict.observe(vehicle(true, 2), c, now);
assert.equal(conflict.reserve(c, now).live, false);
// Missing timezone/future/stale flags all fail closed.
for (const stamp of [null, '2026-01-01T00:00:00', 'invalid']) {
  assert.equal(mode({...vehicle(true,2),last_updated_at:stamp},c,now), 'stale');
}
// Shared account budget, isolated episode and timestamp evidence.
const budget = require('../adaptive_polling').accountBudget(boot);
const a = new Poller(boot, budget), b = new Poller(boot, budget);
a.observe(vehicle(true,2),c,now); a.reserve(c,now);
a.fail(c,now);
b.observe(vehicle(false,2,now+1),c,now+1);
a.observe(vehicle(true,2,now+2),c,now+2);
assert.equal(a.reserve(c,now+2).live,false);
assert.equal(a.started,now);
assert.equal(b.started,null);
assert.equal(a.account,b.account);
const capAccount = require('../adaptive_polling').accountBudget(boot);
const cars = [new Poller(boot,capAccount),new Poller(boot,capAccount)];
for(let i=0;i<6;i++) {
  const car=cars[i%2]; car.observe(vehicle(true,2,now+i),c,now+i);
  assert(car.reserve(c,now+i).live);
}
assert.equal(cars[0].reserve(c,now+6).reason,'hourly live limit');
const backoff = new Poller(boot);
for(let i=0;i<5;i++) {
  backoff.fail(c,now);
  assert.equal(backoff.due-now,c.staleInterval*2**Math.min(i,3));
}
console.log('adaptive safety regression tests passed');
