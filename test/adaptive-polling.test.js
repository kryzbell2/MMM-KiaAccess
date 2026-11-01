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
  assert(h.adaptive[h.acctKeyFor(config)].blocked);
  const legacy = { ...config, username: "legacy", refresh: true, adaptivePolling: { enabled: false }, forceRefreshTimeout: 45 };
  h.handleFetch(legacy); assert.equal(jobs[1].refresh, true); assert.equal(jobs[1].forceRefreshTimeout, 45);
  children[1].emit("error", new Error("mock auth"));
} finally { cp.spawn = original; }
console.log("adaptive polling tests passed");
