"use strict";
const DEFAULTS = Object.freeze({ enabled: true, chargingInterval: 600000, pluggedInterval: 1800000,
  idleInterval: 3600000, staleInterval: 3600000, statusMaxAge: 1200000,
  liveRefreshTimeout: 30, maxLiveRequestsPerHour: 6, maxContinuousActiveMinutes: 90 });
function options(value) {
  const c = Object.assign({}, DEFAULTS, value);
  for (const k of Object.keys(DEFAULTS).filter(k => k !== "enabled")) {
    if (!Number.isFinite(c[k]) || c[k] <= 0) c[k] = DEFAULTS[k];
  }
  c.statusMaxAge = Math.min(c.statusMaxAge, DEFAULTS.statusMaxAge);
  c.maxLiveRequestsPerHour = Math.min(c.maxLiveRequestsPerHour, 6);
  c.maxContinuousActiveMinutes = Math.min(c.maxContinuousActiveMinutes, 90);
  return c;
}
function timestamp(v) {
  const raw = v && v.last_updated_at;
  // Reject timezone-free dates rather than guessing the vehicle's local zone.
  return typeof raw === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? Date.parse(raw) : NaN;
}
function mode(v, c, now) {
  const t = timestamp(v);
  if (!Number.isFinite(t) || t > now || now - t > c.statusMaxAge) return "stale";
  const charging = v.ev_battery_is_charging;
  const plug = v.ev_battery_is_plugged_in;
  if (plug === false || plug === 0) return "idle";
  // USA batteryPlugin is an integer connector code, not a boolean.
  const connected = plug === true || (Number.isInteger(plug) && plug > 0 && plug <= 4);
  if (connected && (charging === true || charging === 1)) return "charging";
  if (connected && (charging === false || charging === 0)) return "plugged";
  return "stale";
}
class Poller {
  constructor(now = Date.now()) {
    this.bootUntil = now + 3600000; // no lost budget can be reused after restart
    this.times = []; this.started = null; this.blocked = false; this.last = null;
    this.mode = "stale"; this.busy = false; this.due = 0; this.failures = 0;
  }
  observe(v, c, now, live = false, warning = false) {
    const t = timestamp(v), previous = timestamp(this.last);
    this.mode = mode(v, c, now);
    if (warning || (this.started !== null && this.mode === "stale") || (live && (!Number.isFinite(t) || t <= previous))) this.blocked = true;
    // Only NEW, fresh evidence of stopped charging can rearm a latched session.
    if (["idle", "plugged"].includes(this.mode) && (!Number.isFinite(previous) || t > previous)) {
      this.blocked = false; this.started = null;
    }
    this.last = v; this.failures = 0;
    return this.interval(c);
  }
  interval(c) { return c[this.mode === "charging" ? "chargingInterval" : this.mode === "plugged" ? "pluggedInterval" : this.mode === "idle" ? "idleInterval" : "staleInterval"]; }
  reserve(c, now, multi = false) {
    this.mode = mode(this.last, c, now);
    this.times = this.times.filter(t => now - t < 3600000);
    let reason = "cached cloud retrieval";
    let live = false;
    if (this.mode === "charging" && !multi) {
      if (now < this.bootUntil) reason = "restart cooldown";
      else if (this.blocked) reason = "session safety latch";
      else if (this.times.length >= c.maxLiveRequestsPerHour) reason = "hourly live limit";
      else if (this.started !== null && now - this.started >= c.maxContinuousActiveMinutes * 60000) {
        this.blocked = true; reason = "continuous active limit";
      } else {
        live = true; reason = "active vehicle refresh";
        if (this.started === null) this.started = now;
        this.times.push(now);
      }
    }
    return { live, reason };
  }
  fail(c, now) {
    this.blocked = true; this.mode = "stale";
    this.due = now + Math.max(c.staleInterval, Math.min(8, 2 ** this.failures++) * 300000);
  }
}
module.exports = { DEFAULTS, options, timestamp, mode, Poller };
