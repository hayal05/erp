// Production boot smoke test with temporary in-memory credentials and no database/service access.
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
const secret=randomBytes(48).toString('hex');
const env={...process.env,NODE_ENV:'production',DATABASE_URL:'postgres://unused:unused@127.0.0.1:1/natra_smoke_test',SESSION_SECRET:secret,FRONTEND_URL:'https://frontend.example.test',CLOUDINARY_CLOUD_NAME:'',CLOUDINARY_API_KEY:'',CLOUDINARY_API_SECRET:''};
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise((resolve,reject)=>probe.close(e=>e?reject(e):resolve()));
const child=spawn(process.execPath,['src/server.js'],{cwd:root,env:{...env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let output='',timer;
try{
 await new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(new Error('Production server did not start')),10000);
  child.on('error',()=>reject(new Error('Could not start production server')));
  child.once('exit',()=>reject(new Error('Production server exited before readiness')));
  child.stdout.on('data',d=>{output+=d;if(output.includes('API listening'))resolve();});child.stderr.on('data',d=>{output+=d;});
 });
 clearTimeout(timer);
 const health=await fetch(`http://127.0.0.1:${port}/health`,{headers:{Origin:env.FRONTEND_URL},signal:AbortSignal.timeout(5000)});
 assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});assert.equal(health.headers.get('access-control-allow-origin'),env.FRONTEND_URL);
 const dist=fileURLToPath(new URL('../../frontend/dist/index.html',import.meta.url));
 if(fs.existsSync(dist)){const app=await fetch(`http://127.0.0.1:${port}/employees`,{signal:AbortSignal.timeout(5000)});assert.equal(app.status,200);assert.ok((await app.text()).includes('id="root"'));assert.ok(app.headers.get('content-security-policy').includes('script-src'));}
 const guarded=await fetch(`http://127.0.0.1:${port}/api/employees`,{signal:AbortSignal.timeout(5000)});assert.equal(guarded.status,401);
 assert.ok(!output.includes(secret));assert.ok(!output.includes(env.DATABASE_URL));
 const missing=spawnSync(process.execPath,['--input-type=module','-e',"await import('./src/config.js')"],{cwd:root,env:{...env,DATABASE_URL:'',SESSION_SECRET:'',FRONTEND_URL:''},encoding:'utf8'});
 assert.notEqual(missing.status,0);assert.ok(missing.stderr.includes('Missing required environment variable'));
 console.log('Production smoke passed: boot, /health, CORS, anonymous guard, missing-config rejection and secret-free startup output. No database or Cloudinary connection was used.');
}finally{
 clearTimeout(timer);
 if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);await exited;clearTimeout(killTimer);}
}
