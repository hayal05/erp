import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {incrementalReads} from '../src/middleware/incrementalReads.js';
import {diffJson,applyJsonDelta} from '../../shared/jsonDelta.mjs';
const rows=()=>Array.from({length:30},(_,i)=>({id:i,name:`Employee ${i}`,department:'Operations',position:'Senior specialist',salary:10000}));
function harness(options){
 const app=express();let current={items:rows(),total:30},allowed=true,hits=0,permissions=['employees.read'];
 app.use((req,res,next)=>{req.user={id:req.get('Test-User')||'1',permissions};req.session={id:req.get('Test-Session')||'session1'};next();});
 app.use(incrementalReads(options));
 app.get(['/api/employees','/api/attendance-records/1/photos/check_in'],(req,res)=>{hits++;if(!allowed)return res.status(403).json({error:{code:'forbidden'}});res.set('Cache-Control','no-store');res.json(current);});
 return {get:(version='initial',path='/api/employees',headers={})=>request(app).get(path).set({'X-Data-Delta':version,...headers}),
 set:v=>current=v,deny:()=>allowed=false,permissions:p=>permissions=p,hits:()=>hits};
}
test('response patches preserve inserted, deleted, edited and reordered employees and totals',()=>{
 const before={items:rows(),total:30,oldField:true};
 const after={items:[{id:50,name:'New'},...before.items.slice(1).reverse()],total:30};
 after.items[5]={...after.items[5],name:'Changed'};
 const patch=diffJson(before,after),result=applyJsonDelta(before,patch);
 assert.deepEqual(result,after);assert.equal(before.items[0].name,'Employee 0');
 assert.ok(JSON.stringify(patch).length<JSON.stringify(after).length);
 assert.equal(result.items[1],before.items.at(-1),'unchanged objects are reused');
});
test('patches round-trip JSON shapes, including nulls, primitive arrays and unusual field names',()=>{
 const values=[null,0,false,'',[],[1,2],{},JSON.parse('{"__proto__":{"safe":true},"constructor":1}'),{items:[]},{items:rows().slice(0,2)},[{id:'1',value:null},{id:1,value:false}]];
 for(const before of values)for(const after of values)assert.deepEqual(applyJsonDelta(before,diffJson(before,after)),after);
 assert.equal({}.safe,undefined);
});
test('same page returns a small no-change patch; changed rows and removals reconstruct the current page',async()=>{
 const h=harness(),first=await h.get();assert.equal(first.body.kind,'full');
 const same=await h.get(first.body.version);assert.equal(same.body.kind,'delta');assert.equal(same.body.patch,null);assert.equal(same.headers['cache-control'],'no-store');
 const next={items:first.body.data.items.slice(2),total:28};next.items[0]={...next.items[0],name:'Updated'};h.set(next);
 const changed=await h.get(first.body.version);assert.equal(changed.body.kind,'delta');
 assert.deepEqual(applyJsonDelta(first.body.data,changed.body.patch),next);assert.equal(h.hits(),3,'refresh still runs the route');
});
test('baselines are isolated by session, user, query and permissions; authorization errors never reuse cached records',async()=>{
 const h=harness(),first=await h.get();
 for(const headers of [{'Test-Session':'other'},{'Test-User':'other'}])assert.equal((await h.get(first.body.version,'/api/employees',headers)).body.kind,'full');
 assert.equal((await h.get(first.body.version,'/api/employees?page=2')).body.kind,'full');
 h.permissions(['employees.read','employees.manage']);assert.equal((await h.get(first.body.version)).body.kind,'full');
 h.deny();const denied=await h.get(first.body.version);assert.equal(denied.status,403);assert.equal(denied.body._natraDelta,undefined);assert.equal(denied.body.items,undefined);
});
test('expiry, eviction and a missing baseline safely fall back to full data',async()=>{
 let clock=0;const h=harness({maxEntries:1,ttlMs:10,now:()=>clock}),first=await h.get();
 clock=11;assert.equal((await h.get(first.body.version)).body.kind,'full');
 await h.get('initial','/api/employees?page=2');assert.equal((await h.get(first.body.version)).body.kind,'full');
 assert.equal((await h.get('unknown')).body.kind,'full');
});
test('signed photo links and clients without opt-in keep the ordinary response shape',async()=>{
 const h=harness();const photo=await h.get('initial','/api/attendance-records/1/photos/check_in');assert.equal(photo.body._natraDelta,undefined);
 const ordinary=await h.get('','/api/employees');assert.equal(ordinary.body._natraDelta,undefined);
});
