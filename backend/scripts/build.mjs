// Backend ships as native ES modules: validate every source file, without needing runtime secrets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
async function files(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await files(p));else if(e.name.endsWith('.js'))out.push(p);}return out;}
const source=(await files(path.join(root,'src'))).sort();
for(const file of source){const r=spawnSync(process.execPath,['--check',file],{stdio:'pipe',encoding:'utf8'});if(r.status!==0){console.error(`Backend syntax check failed: ${path.relative(root,file)}`);process.exit(1);}}
console.log(`Backend build passed: ${source.length} native ES-module source files checked. No transpilation required.`);
