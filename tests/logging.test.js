import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportFailure} from '../src/services/logging.js';
import {errorHandler} from '../src/middleware/error.js';
import {redact} from '../src/services/audit.js';
import {config} from '../src/config.js';
const secret='SENTINEL-password-token-api-key-photo-path';
function capture(fn){const original=console.error,lines=[];console.error=(...a)=>lines.push(a.join(' '));try{return {result:fn(),lines};}finally{console.error=original;}}
test('operational logs allow only fixed events/codes, never exception data or arbitrary context',()=>{
 const {lines}=capture(()=>{
  for(const event of ['request','database','migration','seed',secret])reportFailure(event,{code:secret,message:secret,stack:secret,detail:secret});
  reportFailure('database',{code:'ECONNRESET',message:secret});
 });
 assert.ok(!lines.join(' ').includes(secret));assert.equal(lines[4],'[operation] failed (internal_error)');assert.equal(lines[5],'[database] failed (ECONNRESET)');
});
test('production error logs and 500 responses exclude request secrets and exception details',()=>{
 const previous={isTest:config.isTest,isProd:config.isProd};config.isTest=false;config.isProd=true;
 try{
  let status,body;const res={headersSent:false,status:n=>{status=n;return res;},json:value=>{body=value;}};
  const err=Object.assign(new Error(secret),{details:{password:secret},code:'23514'});
  const {lines}=capture(()=>errorHandler(err,{method:'POST',path:`/api/${secret}`,url:`/?token=${secret}`,body:{password:secret}},res,()=>{}));
  assert.equal(status,500);assert.deepEqual(body,{error:{code:'server_error',message:'Internal server error'}});assert.deepEqual(lines,['[request] failed (23514)']);
  assert.ok(!JSON.stringify({lines,body}).includes(secret));
 }finally{Object.assign(config,previous);}
});
test('audit redaction covers nested credentials, database URLs and photo/selfie identifiers',()=>{
 const output=redact({apiKey:secret,credentials:{value:secret},database_url:secret,connectionString:secret,items:[{photoId:secret,selfieUrl:secret}],safe:{count:3}});
 assert.ok(!JSON.stringify(output).includes(secret));assert.equal(output.safe.count,3);
});
