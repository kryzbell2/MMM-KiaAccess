const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const SP=require('../server_profiles');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'server-profiles-'));
const web=path.join(tmp,'web');fs.mkdirSync(web);
const file=path.join(tmp,'accounts.local.json');
const secret={username:'SYNTHETIC_EMAIL',password:'SYNTHETIC_PASSWORD',pin:'1357',region:'USA',brand:'KIA',refresh:false,adaptivePolling:{enabled:false},pythonBin:'python3'};
fs.writeFileSync(file,JSON.stringify({profiles:{bluebell:secret}}),{mode:0o600});
const loaded=SP.load(file,web);
assert(!loaded.error);
const resolved=loaded.resolve({credentialProfile:'bluebell',password:'ATTACKER',refresh:true,adaptivePolling:{enabled:true},maxRequestsPerHour:9999,pythonBin:'ATTACKER',webhook:{url:'ATTACKER'}});
assert.equal(resolved.adaptivePolling.enabled,false);assert.equal(resolved.maxRequestsPerHour,undefined);
assert.equal(resolved.password,secret.password);assert.equal(resolved.refresh,false);assert.equal(resolved.pythonBin,'python3');assert.equal(resolved.webhook,undefined);
assert.equal(loaded.resolve({credentialProfile:'__proto__'}),null);
assert.equal(loaded.resolve({credentialProfile:'../accounts'}),null);
assert.equal(SP.load(path.join(tmp,'missing'),web).configured,true);
assert.equal(SP.load(path.join(tmp,'missing'),web).resolve({credentialProfile:'bluebell'}),null);
fs.copyFileSync(file,path.join(web,'exposed.json'));
assert(SP.load(path.join(web,'exposed.json'),web).error);
if(process.platform!=='win32') {
 fs.chmodSync(file,0o644);assert(SP.load(file,web).error);fs.chmodSync(file,0o600);
}
const mod=require('./require-mm-module')();
mod.config={...mod.defaults,...secret,credentialProfile:'bluebell'};
assert.deepEqual(mod.serialisableConfig(),{credentialProfile:'bluebell'});
assert(mod.isForMe('profile:bluebell|auto'));
assert(!mod.isForMe('USA|KIA|SYNTHETIC_EMAIL|auto'));
const {freshHelper,tmpCacheDir}=require('./fresh-node-helper');
const helper=freshHelper(tmpCacheDir());helper.serverProfiles=loaded;
const requests=[];helper.handleFetch=c=>requests.push(c);
helper.sendSocketNotification=()=>{};
helper.socketNotificationReceived('KIA_FETCH',{credentialProfile:'bluebell',refresh:true,pythonBin:'ATTACKER'});
assert.equal(requests.length,1);assert.equal(requests[0].refresh,false);assert.equal(requests[0].pythonBin,'python3');
helper.socketNotificationReceived('KIA_FETCH',{username:'ATTACKER',password:'ATTACKER'});
helper.socketNotificationReceived('KIA_WEBHOOK',{credentialProfile:'bluebell',webhook:{url:'ATTACKER'}});
helper.socketNotificationReceived('KIA_LAST_PARKED',{credentialProfile:'bluebell',identifier:'ATTACKER'});
assert.equal(requests.length,1);
const actualId=helper.identifierFor(resolved);
assert.equal(actualId,'USA|KIA|SYNTHETIC_EMAIL|auto'); // existing cache and token identity retained
let sent;
helper.sendSocketNotification=(n,p)=>sent=p;
helper.emitData(actualId,resolved,{vehicle:{username:secret.username,password:secret.password,pin:secret.pin,car_battery_percentage:88,data:{access_token:'SYNTHETIC_TOKEN',label:secret.username}},_meta:{note:secret.password}});
const wire=JSON.stringify(sent);
for(const value of [...Object.values(secret).filter(v=>typeof v==='string'&&v.startsWith('SYNTHETIC')),secret.pin,'SYNTHETIC_TOKEN'])assert(!wire.includes(value),value);
assert.equal(sent.payload.vehicle.data,undefined);
assert.equal(sent.identifier,'profile:bluebell|auto');assert.equal(sent.payload.vehicle.car_battery_percentage,88);
assert.equal(SP.load().configured,false); // legacy installations keep working until explicitly migrated
console.log('server profile boundary, permissions, injection and socket redaction tests passed');

assert.equal(loaded.cacheDir,path.join(tmp,'state','cache'));
