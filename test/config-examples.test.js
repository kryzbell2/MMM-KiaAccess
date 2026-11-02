/* Validate the literal snippets in their actual modules-array context. */
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
for(const name of ['bluebell.config.example.js','bluebell.server.config.example.js']) {
  const source=fs.readFileSync(path.join(__dirname,'..','examples',name),'utf8');
  const bare=source.replace(/^\s*\/\/.*$/gm,'').trim();
  assert(bare.startsWith('{')&&bare.endsWith('}'), name+' must be a bare object');
  assert(!bare.startsWith('({')&&!bare.endsWith('});'));
  const context={module:{exports:{}}};
  vm.runInNewContext('module.exports={modules:[{module:"before"},\n'+source+',\n{module:"after"}]};',context);
  const [before,entry,after]=context.module.exports.modules;
  assert.equal(before.module,'before');assert.equal(after.module,'after');
  assert.equal(entry.module,'MMM-KiaAccess');assert.equal(entry.header,'Blue Beauty');
  const c=entry.config;
  assert.equal(c.adaptivePolling.enabled,false);assert.equal(c.refresh,false);assert.equal(c.forceRefreshTimeout,0);
  assert.equal(c.updateInterval,1800000);assert.equal(c.units,'imperial');assert.equal(c.maxWidth,'320px');
  assert.equal(c.visuals.car,true);assert.equal(c.visuals.battery,true);assert.equal(c.visuals.chargeProgress,false);
  assert.equal(c.visuals.location.enabled,false);assert.equal(c.visuals.location.map,false);
  assert.equal(c.notifications.checks.serviceDue,false);assert.equal(c.showTable,false);
  assert.equal(c.showReportedInHeader,true);
  assert(c.include.includes('vehicle.car_battery_percentage'));
  assert(c.visuals.batteryDetail.includes('vehicle.car_battery_percentage'));
  if(name.includes('.server.')) {
    assert.equal(c.credentialProfile,'bluebell');
    for(const k of ['username','password','pin','token'])assert(!Object.hasOwn(c,k));
  } else assert.equal(c.username,'YOUR_KIA_EMAIL');
}
console.log('paste-ready Blue Beauty configuration tests passed');
