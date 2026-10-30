import {createHash} from 'node:crypto';
import {diffJson} from '../../../shared/jsonDelta.mjs';

const READ_PATH = /^\/api\/(employees|departments|positions|shifts|attendance-records|attendance|leave|leave-admin|payroll-settings|salary-profiles|deductions|settlements|payroll-costs|payroll|payslips|settings|dashboard|profile|announcements|change-requests|access-management|audit-history)(\/|$)/;
// Baselines are private, bounded, short-lived server memory. No cookies or browser
// HTTP caches hold response bodies. Every refresh still runs the normal route guards.
export function incrementalReads({maxBytes=8*1024*1024,maxEntries=128,ttlMs=10*60_000,now=Date.now}={}) {
  const snapshots=new Map(); let bytes=0;
  const drop=key=>{const old=snapshots.get(key);if(old){bytes-=old.size;snapshots.delete(key);}};
  return (req,res,next)=>{
    if(req.method!=='GET'||!req.session?.id||!req.user||!req.get('X-Data-Delta')
      ||!READ_PATH.test(req.path)||/\/photos\/|\/export(?:\/|$)|\.csv$/.test(req.path))return next();
    const json=res.json.bind(res);
    res.json=body=>{
      if(res.statusCode!==200)return json(body);
      const stamp=now();
      for(const [key,value]of snapshots)if(value.expires<=stamp)drop(key);
      const key=createHash('sha256').update(JSON.stringify([req.session.id,req.user.id,req.user.permissions,req.originalUrl])).digest('hex');
      const serialized=JSON.stringify(body),size=Buffer.byteLength(serialized);
      // Large payloads do not displace the entire cache. They retain the regular API shape.
      if(size>256*1024||size>maxBytes)return json(body);
      const data=JSON.parse(serialized),version=createHash('sha256').update(serialized).digest('hex');
      const old=snapshots.get(key),base=req.get('X-Data-Delta');
      let response={_natraDelta:1,kind:'full',version,data};
      if(old&&old.version===base){
        const patch=diffJson(old.data,data);
        const delta={_natraDelta:1,kind:'delta',baseVersion:base,version,patch};
        if(patch===null||Buffer.byteLength(JSON.stringify(delta))<Buffer.byteLength(JSON.stringify(response)))response=delta;
      }
      drop(key);
      while(snapshots.size&&(snapshots.size>=maxEntries||bytes+size>maxBytes))drop(snapshots.keys().next().value);
      snapshots.set(key,{data,version,size,expires:stamp+ttlMs});bytes+=size;
      res.set('Cache-Control','no-store');res.vary('X-Data-Delta');
      return json(response);
    };
    next();
  };
}
