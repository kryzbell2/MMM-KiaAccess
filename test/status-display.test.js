"use strict";
const assert=require('assert');
const Status=require('../core/status');
const AP=require('../adaptive_polling');
const PG=require('../polling_guard');
const SP=require('../server_profiles');
const load=require('./require-mm-module');
const {freshHelper,tmpCacheDir}=require('./fresh-node-helper');
const {EventEmitter}=require('events');
const cp=require('child_process');
const logger=require('./stubs/logger');
const originalNow=Date.now,originalSpawn=cp.spawn;
let now=Date.parse('2026-11-01T23:00:00Z');
Date.now=()=>now;
const iso=t=>new Date(t).toISOString();
const vehicle=t=>({last_updated_at:iso(t),is_locked:false,ev_battery_is_charging:true,
  ev_battery_is_plugged_in:2,ev_battery_percentage:69,car_battery_percentage:97});
const payload=(t=now,meta={})=>({vehicle:vehicle(t),_meta:{fetchedAt:iso(now),requestStatus:{state:'success'},...meta}});
const logs=[];const previousLogs={...logger};
for(const level of ['info','warn','error'])logger[level]=m=>logs.push({level,m});
const jobs=[],children=[];
cp.spawn=()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
 child.stdin.write=s=>jobs.push(JSON.parse(s));child.stdin.end=()=>{};child.kill=()=>{};children.push(child);return child;
};
try {
 // Pure presentation states: report age, not retrieval age, determines freshness.
 assert.equal(Status.evaluate(payload(),undefined,now).state,'normal');
 assert.equal(Status.evaluate(payload(now,{telemetry:'unchanged'}),undefined,now).state,'cached');
 assert.equal(Status.evaluate(payload(now-21*60000),undefined,now).state,'cached');
 assert.equal(Status.evaluate(payload(now-61*60000),undefined,now).state,'stale');
 assert.equal(Status.evaluate(payload(now-11*60000),10*60000,now).state,'stale');
 assert.equal(Status.evaluate(payload(now-21*60000),2*3600000,now).historical,true,'longer display threshold cannot make security fresh');
 for(const stamp of [undefined,'garbage','2026-11-01T22:59:00',iso(now+60000)]) {
   const p=payload();p.vehicle.last_updated_at=stamp;
   const status=Status.evaluate(p,undefined,now);
   assert.equal(status.state,'stale');assert.equal(status.reportTime,null);assert(status.historyText.includes('Not verified current'));
 }
 // Successful live report persisted, then cached-only restart hits persisted interval.
 const dir=tmpCacheDir('status-');
 const config={username:'SYNTHETIC_USER',password:'SYNTHETIC_PASSWORD',pin:'1357',vin:'SYNTHETIC_VIN',
   region:'USA',brand:'KIA',refresh:false,forceRefreshTimeout:0,adaptivePolling:{enabled:false},_credentialProfile:'bluebell'};
 let h=freshHelper(dir);const id=h.identifierFor(config),key=h.acctKeyFor(config);
 h.onPayload(id,config,payload(now,{retrievalSource:'live'}));
 const saved=h.st(id).lastGood;
 const account=AP.accountBudget(now);let lease=PG.acquire(dir,key,account,config,now);assert(lease.allowed);lease.release();
 const originalBudget=JSON.stringify({times:account.times,nextAt:account.nextAt,bootUntil:account.bootUntil});
 h=freshHelper(dir);let sent=[];h.sendSocketNotification=(n,d)=>sent.push({n,d});
 now+=60000;h.handleFetch(config);
 assert.equal(jobs.length,0,'restart deferral must not spawn bridge');
 let p=sent.at(-1).d.payload;
 assert.equal(Status.evaluate(p,undefined,now).state,'cached');assert.equal(Status.evaluate(p,undefined,now).warning,'');
 assert.equal(p._meta.fetchedAt,saved._meta.fetchedAt,'replay does not claim a new successful retrieval');
 assert.equal(p.vehicle.last_updated_at,saved.vehicle.last_updated_at);
 const acct=h.adaptiveAccounts[key];
 assert.equal(JSON.stringify({times:acct.times,nextAt:acct.nextAt,bootUntil:acct.bootUntil}),originalBudget,'diagnostics cannot change wake reservation or cooldown');
 assert(logs.some(x=>x.level==='info'&&x.m.includes('minimum interval')&&x.m.includes('next permitted')));
 // Expired interval permits cached reads only. In-flight duplicate causes no request.
 now+=300001;h.handleFetch(config);assert.equal(jobs.length,1);h.handleFetch(config);h.handleFetch(config);
 assert.equal(jobs.length,1);assert.equal(jobs[0].refresh,false);assert.equal(jobs[0].forceRefreshTimeout,0);
 assert.equal(logs.filter(x=>x.m.includes('another fetch')).length,1,'duplicate diagnostics throttled');
 const secret='SYNTHETIC_PASSWORD SYNTHETIC_USER SYNTHETIC_VIN 1357 TOKEN latitude=12.345';
 children.at(-1).stdout.emit('data',JSON.stringify({ok:false,error:secret,errorKind:'authentication'}));children.at(-1).emit('close',0);
 p=sent.at(-1).d.payload;
 assert.equal(Status.evaluate(p,undefined,now).state,'error');assert(Status.evaluate(p,undefined,now).warning.includes('authentication'));
 assert.equal(p._meta.fetchedAt,saved._meta.fetchedAt);
 now+=1;h.handleFetch(config);assert.equal(jobs.length,1);
 assert.equal(Status.evaluate(sent.at(-1).d.payload,undefined,now).state,'error','backoff does not clear prior failure');
 assert(logs.some(x=>x.m.includes('API backoff')));assert(logs.some(x=>x.level==='warn'&&x.m.includes('authentication failure')));
 assert(!JSON.stringify(logs).includes('SYNTHETIC'),'server diagnostics do not reveal identities or exception text');
 assert(!JSON.stringify(sent).includes('SYNTHETIC'),'secure browser payload removes account/vehicle secrets');
 // Recovery clears failure and unchanged cloud report remains visibly cached.
 now+=300001;h.handleFetch(config);assert.equal(jobs.length,2);
 children.at(-1).stdout.emit('data',JSON.stringify({ok:true,vehicles:[vehicle(now)],meta:{retrievalSource:'cached_cloud'}}));children.at(-1).emit('close',0);
 p=sent.at(-1).d.payload;assert.equal(Status.evaluate(p,undefined,now).state,'normal');assert.equal(Status.evaluate(p,undefined,now).warning,'');
 assert.equal(h.adaptiveAccounts[key].lastFailureKind,null);

 now+=300001;h.handleFetch(config);
 children.at(-1).stdout.emit('data',JSON.stringify({ok:true,vehicles:[p.vehicle],meta:{retrievalSource:'cached_cloud'}}));children.at(-1).emit('close',0);
 assert.equal(Status.evaluate(sent.at(-1).d.payload,undefined,now).state,'cached');
 assert(logs.some(x=>x.m.includes('cached retrieval succeeded; vehicle telemetry unchanged')));
 const persisted=require('fs').readFileSync(h.cacheFile(id),'utf8');
 assert.equal(JSON.parse(persisted).lastGood._meta.fetchedAt,sent.at(-1).d.payload._meta.fetchedAt,'unchanged successful retrieval survives restart');
 h.fail(id,config,secret,'api');assert(Status.evaluate(sent.at(-1).d.payload,undefined,now).warning.includes('data unavailable'));
 // Unknown kinds and legacy errors can only produce fixed browser text.
 const hostile=payload(now,{error:secret,requestStatus:{state:'error',kind:secret}});
 assert(!JSON.stringify(Status.evaluate(hostile,undefined,now)).includes('SYNTHETIC'));
 const sanitized=SP.toBrowser(hostile,config);assert(!JSON.stringify(sanitized).includes('SYNTHETIC_PASSWORD'));
 // DOM + real condition engine: old unlocked/charging never means current.
 const m=load();m.config={...m.defaults,showReportedInHeader:true,showTable:false,showUpdatedFooter:false,visuals:{enabled:false},notifications:{enabled:true,notifyOnStartup:true}};
 m.sendSocketNotification=()=>{};m.sendNotification=()=>{};m.updateDom=()=>{};m.start();clearTimeout(m._timer);clearTimeout(m._watchdog);
 m.data={header:'Blue Beauty'};m.stateBuilder=require('../core/state');m.conditions=require('../core/conditions');m.visuals=require('../core/visuals');
 const alerts=[];m.sendNotification=(n,p)=>alerts.push({n,p});
 m.rawPayload=payload(now);m.flatMap=require('../core/flatten').flatten(m.rawPayload);m.viewData=[];
 m.processConditions();assert(m.diagramAlerts.some(x=>/unlock/i.test(x.label)),'fresh unlocked alert stays prominent');
 const lastPrev=m.prevCond.unlocked;
 m.rawPayload=payload(now-90*60000);m.flatMap=require('../core/flatten').flatten(m.rawPayload);m.syncDisplayStatus();m.processConditions();
 assert.equal(m.visualState().locked,null);assert.equal(m.visualState().charging,null);assert.equal(m.diagramAlerts.length,0);
 assert.equal(m.prevCond.unlocked,lastPrev,'historical data must not send a confirmed clear');
 assert(m.getHeader().includes('STALE'));assert(m.getHeader().includes('as of:'));
 global.document={createElement:()=>({className:'',style:{setProperty(){}},children:[],classList:{toggle(){}},appendChild(e){this.children.push(e);}})};
 let dom=m.getDom();assert(dom.children[0].textContent.includes('Last reported: unlocked'));assert(!dom.children[0].className.includes('is-error'));
 assert(dom.title.includes('Last successful retrieval'));assert(dom.title.includes('Vehicle reported'));
 m.rawPayload=payload(now,{requestStatus:{state:'deferred',reason:'minimum_interval',nextRequestAt:iso(now+300000)}});m.flatMap={};m.diagramAlerts=[];m.syncDisplayStatus();
 dom=m.getDom();assert.equal(dom.children.length,0,'routine cached cooldown has no banner');assert(m.getHeader().endsWith('CACHED'));
 m.rawPayload=payload(now,{requestStatus:{state:'error',kind:'network'}});m.syncDisplayStatus();dom=m.getDom();assert(dom.children[0].className.includes('is-error'));
 // Real socket recovery drops the previous typed failure without leaking raw error text.
 m.scheduleFetch=()=>{};m.rebuildView=function(){this.flatMap=require('../core/flatten').flatten(this.rawPayload);this.viewData=[];};
 const moduleId=m._fullIdentifier(null);
 m.socketNotificationReceived('KIA_ERROR',{identifier:moduleId,error:secret,requestStatus:{state:'error',kind:'api'}});
 assert(m.errorMessage.includes('unavailable'));assert(!m.errorMessage.includes('SYNTHETIC'));
 m.socketNotificationReceived('KIA_DATA',{identifier:moduleId,payload:payload(now)});
 assert.equal(m.errorMessage,null);assert.equal(m.waitingForData,false);clearInterval(m._liveTimer);m._liveTimer=null;
 // Advancing display time uses a local interval and cannot request data.
 const oldInterval=global.setInterval,oldClear=global.clearInterval;let tick,socketCalls=0;
 try {global.setInterval=fn=>(tick=fn,42);global.clearInterval=()=>{};m.sendSocketNotification=n=>{if(n==="KIA_FETCH")socketCalls++;};
   m.rawPayload=payload(now);m.flatMap={};m.liveChargeTimer();now+=3600001;tick();assert.equal(m.displayStatus().state,'stale');assert.equal(socketCalls,0);
 } finally {global.setInterval=oldInterval;global.clearInterval=oldClear;clearInterval(m._liveTimer);}
 // Display thresholds/status codes never change adaptive safety decisions.
 const c=AP.options({enabled:true}),poller=new AP.Poller(now);poller.observe(vehicle(now-90*60000),c,now);
 for(const threshold of [60000,3600000,86400000]){Status.evaluate(payload(now-90*60000),threshold,now);assert.equal(poller.reserve(c,now).live,false);}
 assert.equal(AP.options().enabled,false);assert.equal(c.statusMaxAge,1200000);
 console.log('all status-display tests passed (mock bridge, cache, DOM, alert and guard regressions)');
} finally {Date.now=originalNow;cp.spawn=originalSpawn;Object.assign(logger,previousLogs);}
