import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {diffJson} from '../../shared/jsonDelta.mjs';
import {readBaseline,decodeIncrementalData,clearIncrementalData,syncIncrementalIdentity} from '../src/api/incrementalData.js';
import {get,setCsrfToken,onSessionEvent} from '../src/api/client.js';
beforeEach(()=>{clearIncrementalData();setCsrfToken(null);onSessionEvent(null);});
const full=(data,version='one')=>({_natraDelta:1,kind:'full',version,data});
test('incremental client merges edits, inserts and deletions without losing totals or ordering',()=>{
 const before={items:[{id:1,name:'Old'},{id:2,name:'Keep'}],total:2},after={items:[{id:2,name:'Keep'},{id:3,name:'New'}],total:2};
 decodeIncrementalData('/employees',full(before),readBaseline('/employees'));
 const result=decodeIncrementalData('/employees',{_natraDelta:1,kind:'delta',baseVersion:'one',version:'two',patch:diffJson(before,after)},readBaseline('/employees'));
 assert.deepEqual(result,after);assert.equal(result.items[0],before.items[1]);assert.equal(readBaseline('/employees').entry.version,'two');
});
test('session and permission changes clear baselines; old in-flight responses cannot repopulate them',()=>{
 syncIncrementalIdentity({user:{id:1,permissions:['read']}});
 decodeIncrementalData('/employees',full({items:[]}),readBaseline('/employees'));
 const old=readBaseline('/employees');syncIncrementalIdentity({user:{id:1,permissions:[]}});
 assert.equal(readBaseline('/employees').entry,undefined);
 assert.throws(()=>decodeIncrementalData('/employees',full({private:true}),old),/Session changed/);
});
test('API sends its baseline, reuses unchanged data and asks for a full fetch if a baseline mismatches',async()=>{
 const calls=[];let n=0;
 globalThis.fetch=async(url,init)=>{calls.push(init.headers['X-Data-Delta']);n++;return {ok:true,status:200,json:async()=>n===1?full({items:[{id:1,name:'First'}]}):n===2?{_natraDelta:1,kind:'delta',baseVersion:'one',version:'one',patch:null}:n===3?{_natraDelta:1,kind:'delta',baseVersion:'missing',version:'two',patch:null}:full({items:[{id:2,name:'New'}]},'two')};};
 assert.equal((await get('/employees')).items[0].id,1);
 assert.equal((await get('/employees')).items[0].id,1);
 assert.equal((await get('/employees')).items[0].id,2);
 assert.deepEqual(calls,['initial','one','one','initial']);
});
test('a forbidden refresh clears cached data and throws instead of serving a cached result',async()=>{
 decodeIncrementalData('/api/employees',full({items:[{id:1}]}),readBaseline('/api/employees'));
 globalThis.fetch=async()=>({ok:false,status:403,json:async()=>({error:{code:'forbidden',message:'Denied'}})});
 await assert.rejects(get('/employees'),e=>e.status===403);
 assert.equal(readBaseline('/api/employees').entry,undefined);
});
