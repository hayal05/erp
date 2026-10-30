import {applyJsonDelta} from '../../../shared/jsonDelta.mjs';
const snapshots=new Map();let bytes=0,epoch=0,identity;
const MAX_BYTES=4*1024*1024,MAX_ENTRIES=64;
export function clearIncrementalData(){snapshots.clear();bytes=0;epoch++;}
export function syncIncrementalIdentity(data){
  const next=JSON.stringify([data?.user?.id,data?.user?.permissions,data?.locked]);
  if(identity!==next){clearIncrementalData();identity=next;}
}
export function readBaseline(url){return {entry:snapshots.get(url),epoch};}
export function decodeIncrementalData(url,body,baseline){
  if(body?._natraDelta!==1)return body;
  if(baseline.epoch!==epoch)throw new Error('Session changed during refresh');
  let data;
  if(body.kind==='full')data=body.data;
  else if(body.kind==='delta'&&baseline.entry?.version===body.baseVersion)data=applyJsonDelta(baseline.entry.data,body.patch);
  else throw new Error('Missing refresh baseline');
  const size=JSON.stringify(data).length*2;
  const old=snapshots.get(url);if(old){bytes-=old.size;snapshots.delete(url);}
  if(size<=MAX_BYTES){
    while(snapshots.size&&(snapshots.size>=MAX_ENTRIES||bytes+size>MAX_BYTES)){
      const key=snapshots.keys().next().value;bytes-=snapshots.get(key).size;snapshots.delete(key);
    }
    snapshots.set(url,{data,version:body.version,size});bytes+=size;
  }
  return data;
}
