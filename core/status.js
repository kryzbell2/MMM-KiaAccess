/* Presentation only. These thresholds never authorize a vehicle request. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.KiaAccessStatus=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  var DEFAULT_STALE_AFTER=3600000, SECURITY_MAX_AGE=1200000;
  var KINDS=['authentication','network','api','processing','rate_limit'];
  var REASONS=['minimum_interval','api_backoff','guard_cooldown','hourly_limit','in_progress','guard_unavailable','adaptive_wait'];
  function kind(value){return KINDS.indexOf(value)>=0?value:'api';}
  function reason(value){return REASONS.indexOf(value)>=0?value:'minimum_interval';}
  function timestamp(raw){return typeof raw==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(raw)?Date.parse(raw):NaN;}
  function staleAfter(value){return typeof value==='number'&&isFinite(value)&&value>0?Math.max(60000,value):DEFAULT_STALE_AFTER;}
  function failureText(value){
    return {authentication:'Kia authentication unavailable',network:'Kia connection unavailable',api:'Kia data unavailable',processing:'Vehicle data could not be processed',rate_limit:'Request paused by rate protection'}[kind(value)];
  }
  function flag(v){return v===true||v===1||v==='true'||v==='1'?true:v===false||v===0||v==='false'||v==='0'?false:null;}
  function evaluate(payload,threshold,now){
    now=now==null?Date.now():now;
    var meta=payload&&payload._meta||{},vehicle=payload&&payload.vehicle||{};
    var report=timestamp(vehicle.last_updated_at),retrieved=timestamp(meta.fetchedAt);
    var valid=isFinite(report)&&report<=now;
    var age=valid?now-report:null;
    var historical=!valid||meta.telemetry==='unverifiable'||age>Math.min(SECURITY_MAX_AGE,staleAfter(threshold));
    var stale=!valid||meta.telemetry==='unverifiable'||age>staleAfter(threshold);
    var request=meta.requestStatus||{};
    var failed=(request.state==='error'||request.failureActive===true)&&kind(request.kind)!=='rate_limit'||
      request.state==='deferred'&&request.reason==='api_backoff'||!request.state&&!!meta.error;
    var cached=historical||request.state==='deferred'||request.state==='error'||meta.telemetry==='unchanged'||meta.stale===true;
    var state=failed?'error':stale?'stale':cached?'cached':'normal';
    var observations=[];
    if(historical){
      var locked=flag(vehicle.is_locked),charging=flag(vehicle.ev_battery_is_charging);
      if(locked!=null)observations.push(locked?'locked':'unlocked');
      if(charging!=null)observations.push(charging?'charging':'not charging');
    }
    var historyText=historical?(observations.length?'Last reported: '+observations.join(' · ')+'. Not verified current.':'Historical readings; security and charging are not verified current.') : '';
    var warning=failed?failureText(request.kind||request.lastFailureKind)+(payload&&payload.vehicle?'; showing last valid readings.':'; retrying with safety backoff.'):'';
    var reportText=valid?new Date(report).toISOString():'unknown or invalid';
    var retrievedText=isFinite(retrieved)&&retrieved<=now?new Date(retrieved).toISOString():'unknown';
    var source=meta.retrievalSource==='live'?'live request':meta.retrievalSource==='cached_cloud'?'Kia cloud cache':'source not recorded';
    var tooltip='Vehicle reported: '+reportText+'. Last successful retrieval: '+retrievedText+' ('+source+').';
    var next=timestamp(request.nextRequestAt);
    if(isFinite(next))tooltip+=' Next permitted request: '+new Date(next).toISOString()+'.';
    if(meta.telemetry==='unchanged')tooltip+=' Vehicle report unchanged.';
    return {state:state,label:state==='normal'?'':state.toUpperCase(),historical:historical,
      stale:stale,reportTime:valid?report:null,retrievedTime:isFinite(retrieved)&&retrieved<=now?retrieved:null,
      warning:warning,historyText:historyText,tooltip:tooltip};
  }
  return {evaluate:evaluate,timestamp:timestamp,kind:kind,reason:reason,failureText:failureText,
    DEFAULT_STALE_AFTER:DEFAULT_STALE_AFTER,SECURITY_MAX_AGE:SECURITY_MAX_AGE};
});
