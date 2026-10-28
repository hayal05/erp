import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[],sources=[];
for(const name of(await fs.readdir(path.join(root,'tests'))).filter(n=>n.endsWith('.test.js')).sort()){
 const file=path.join(root,'tests',name),source=await fs.readFile(file,'utf8');
 if(source.includes('dbSkip')||source.includes('TEST_DATABASE_URL')){files.push(file);sources.push(source);}
}
// These cases depend on distinct PostgreSQL connections. Never present their exclusion as a pass.
const omitted=[
 '#9 two people scanning the same token at once: exactly one succeeds',
 '#9 one person scanning twice at once with two tokens: a single check-in row, never two',
 'lock: a second transaction waits for the first to finish, then sees its result',
 'each correction is audited; the record shows the latest, two simultaneous corrections both complete',
 'concurrency: two simultaneous scans with the SAME token (two people) -> exactly one succeeds',
 'concurrency: two simultaneous check-ins by ONE person (different tokens) -> one record, the loser keeps its token',
 'deductions 4.8b-6: two generations at once cannot take the same one-time item (the second waits, then does not see it)',
 'two simultaneous requests cannot overspend the balance or overlap',
 'approving cannot create overlapping approved leave (friendly check and the DB constraint)',
 'payroll: concurrent creation never duplicates a month or consumes an item twice',
 'approval: employee/locked access, no entries and concurrent approvals',
 'payment: concurrent recording succeeds once with one audit',
];
for(const name of omitted)if(!sources.some(source=>source.includes(`test('${name}'`)))throw new Error(`Excluded native case was renamed or removed: ${name}`);
const escape=s=>Array.from(s,c=>'.*+?^${}()|[]'.includes(c)||c.charCodeAt(0)===92?String.fromCharCode(92)+c:c).join('');
const pattern=`^(?:${omitted.map(escape).join('|')})$`;
console.log(`Embedded serial database sweep: ${files.length} files. ${omitted.length} native multi-connection cases are EXCLUDED, not verified.`);
const child=spawn(process.execPath,['--import',fileURLToPath(new URL('./pglite-preload.mjs',import.meta.url)),'--test','--test-concurrency=1',`--test-skip-pattern=${pattern}`,...files],{cwd:root,stdio:'inherit'});
child.on('error',()=>{console.error('Could not start embedded sweep');process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
