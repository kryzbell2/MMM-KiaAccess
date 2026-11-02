"use strict";
const fs=require('fs'),path=require('path');
const validName=name=>typeof name==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(name);
function load(file,webRoot=path.resolve(__dirname,'../..')) {
  if(!file) return {configured:false};
  try {
    if(!path.isAbsolute(file)) throw Error('absolute path required');
    const resolved=fs.realpathSync(file);
    for(const candidate of [webRoot,process.cwd()]) {
      const root=fs.realpathSync(candidate),relative=path.relative(root,resolved);
      if(relative===''||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))) throw Error('inside served tree');
    }
    const parent=fs.statSync(path.dirname(resolved));
    if(process.platform!=='win32'&&((parent.mode&0o077)!==0||parent.uid!==process.getuid())) throw Error('private directory required');
    for(const location of [path.join(path.dirname(resolved),'state'),path.join(path.dirname(resolved),'state','cache')]) {
      if(fs.existsSync(location)) {
        if(fs.lstatSync(location).isSymbolicLink()) throw Error('state symlink not allowed');
        for(const candidate of [webRoot,process.cwd()]) {
          const relative=path.relative(fs.realpathSync(candidate),fs.realpathSync(location));
          if(relative===''||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))) throw Error('served state not allowed');
        }
      }
    }
    const stat=fs.statSync(resolved);
    if(!stat.isFile()||stat.size>65536) throw Error('invalid file');
    if(process.platform!=='win32'&&((stat.mode&0o077)!==0||stat.uid!==process.getuid())) throw Error('private owner-only file required');
    const stateDirectory=path.join(path.dirname(resolved),"state");
    const data=JSON.parse(fs.readFileSync(resolved,'utf8'));
    if(!data||typeof data.profiles!=='object'||Array.isArray(data.profiles)) throw Error('invalid profiles');
    const profiles=Object.create(null);
    for(const [name,c] of Object.entries(data.profiles)) {
      if(!validName(name)||!c||typeof c.username!=='string'||!c.username.trim()||typeof c.password!=='string'||!c.password||
          (c.pin!=null&&typeof c.pin!=='string')||(c.rangeMap&&c.rangeMap.enabled!==false)||(c.webhook&&c.webhook.enabled)||c.source&&c.source!=='kia'||c.vehicles&&c.vehicles.length) throw Error('invalid profile');
      profiles[name]={...c,source:'kia',region:c.region||'USA',brand:c.brand||'KIA',
        refresh:c.refresh===true,adaptivePolling:c.adaptivePolling||{enabled:false},_credentialProfile:name,_stateDirectory:stateDirectory};
    }
    return {configured:true,cacheDir:path.join(stateDirectory,"cache"),resolve(request){
      if(!request||!validName(request.credentialProfile)||!Object.hasOwn(profiles,request.credentialProfile)) return null;
      // Ignore every client-supplied backend option. Only the trusted server
      // file can choose accounts, executable paths, live intent and destinations.
      return JSON.parse(JSON.stringify(profiles[request.credentialProfile]));
    }};
  } catch(_) {return {configured:true,error:true,resolve(){return null;}};}
}
const secretKeys=new Set(['username','password','passwd','pin','token','accesstoken','refreshtoken','authorization','sid','rmtoken','secretkey','clientsecret','apikey','email','cookie','setcookie','sessionid','oauthtoken','authtoken']);
function redact(value,config) {
  if(Array.isArray(value))return value.map(v=>redact(v,config));
  if(value&&typeof value==='object') {
    const out={};
    for(const [key,v] of Object.entries(value)) {
      if(["__proto__","constructor","prototype"].includes(key)||secretKeys.has(key.replace(/[^a-z]/gi,'').toLowerCase()))continue;
      if(['note','warning','error'].includes(key)&&typeof v==='string') out[key]='server status; details withheld';
      else out[key]=redact(v,config);
    }
    return out;
  }
  if(typeof value==='string') {
    for(const secret of [config.username,config.password,config.pin].filter(v=>typeof v==='string'&&v)) {
      if(value===secret)return '[redacted]';
      if(secret!==config.pin && secret.length>=4)value=value.split(secret).join('[redacted]');
    }
  }
  return value;
}
function toBrowser(payload,config) {
  const copy={...payload,vehicle:{...(payload.vehicle||{})}};
  // Raw API envelopes are unnecessary for the supported sensor dashboard and
  // can acquire unrecognized authentication/account fields in future libraries.
  delete copy.vehicle.data;
  return redact(copy,config);
}
function identifier(id,config) {return config._credentialProfile?'profile:'+config._credentialProfile+'|auto':id;}
module.exports={load,redact,toBrowser,identifier,validName};
