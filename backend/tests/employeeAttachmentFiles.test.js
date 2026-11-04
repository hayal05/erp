import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAttachment,MAX_ATTACHMENT_BYTES} from '../src/services/employeeAttachments.js';
import {createAttachmentStore} from '../src/services/attachmentStore.js';
import {preview} from '../src/services/changeRequests.js';
import {redact} from '../src/services/audit.js';
const pdf=Buffer.from('%PDF-1.7\nexample document\n%%EOF');
const body=(extra={})=>({fileName:'Employment letter.pdf',direction:'incoming',fileBase64:pdf.toString('base64'),...extra});
test('attachment types are checked from extensions and signatures, not browser MIME declarations',()=>{
 for(const [ext,bytes] of [['pdf',pdf],['doc',Buffer.from('d0cf11e0a1b11ae10000','hex')],['docx',Buffer.from('504b0304','hex').toString('binary')+'word/document.xml'],['xlsx',Buffer.from('504b0304','hex').toString('binary')+'xl/workbook.xml'],['jpg',Buffer.from('ffd8ffe0','hex')],['png',Buffer.from('89504e470d0a1a0a','hex')],['gif',Buffer.from('GIF89a')],['webp',Buffer.from('RIFFxxxxWEBP')]]){
  const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'binary');const f=parseAttachment(body({fileName:`sample.${ext}`,fileBase64:b.toString('base64')}));assert.equal(f.byteSize,b.length);assert.equal(f.extension,ext);
 }
 for(const extra of [{fileName:'program.exe'},{fileName:'../secret.pdf'},{fileName:'a\nb.pdf'},{fileName:'x.jpg'},{direction:'other'},{fileBase64:'bad'},{fileBase64:''},{fileBase64:'YQ=='},{fileName:'x'.repeat(181)+'.pdf'}])assert.throws(()=>parseAttachment(body(extra)),e=>e.status===400);
 assert.throws(()=>parseAttachment(body({fileBase64:Buffer.alloc(MAX_ATTACHMENT_BYTES+1).toString('base64')})),e=>e.status===413);
});
test('file bytes are redacted in approval previews and audit logs',()=>{
 assert.equal(preview(body()).fileBase64,'[protected]');assert.equal(redact(body()).fileBase64,'[redacted]');assert.equal(preview(body()).fileName,'Employment letter.pdf');
});
test('raw attachment storage is authenticated, extension-preserving, and downloads are bounded and time-limited',async()=>{
 const calls={};const sdk={config:c=>calls.config=c,uploader:{upload_stream:(o,cb)=>{calls.upload=o;return {end:b=>{calls.bytes=b;cb(null,{public_id:o.public_id});}};},destroy:async(id,opts)=>{calls.deleted={id,opts};return {result:'ok'};}},utils:{private_download_url:(id,format,opts)=>{calls.signed={id,format,opts};return 'https://api.cloudinary.com/fake-download';}}};
 const store=createAttachmentStore({sdk,cfg:{cloudName:'demo',apiKey:'key',apiSecret:'secret'},now:()=>Date.UTC(2026,10,4),random:()=>'A'.repeat(24),fetcher:async()=>new Response(pdf)});
 const id=await store.upload(parseAttachment(body()));assert.equal(id,'natra/employee-files/2026/'+'A'.repeat(24)+'.pdf');assert.equal(calls.upload.type,'authenticated');assert.equal(calls.upload.resource_type,'raw');assert.equal(calls.upload.overwrite,false);
 assert.deepEqual(await store.download(id),pdf);assert.equal(calls.signed.opts.expires_at,Math.floor(Date.UTC(2026,10,4)/1000)+60);assert.equal(calls.signed.opts.resource_type,'raw');assert.equal(calls.signed.opts.type,'authenticated');
 const oversized=createAttachmentStore({sdk,cfg:{cloudName:'demo',apiKey:'key',apiSecret:'secret'},fetcher:async()=>new Response(Buffer.alloc(MAX_ATTACHMENT_BYTES+1))});
 await assert.rejects(oversized.download(id),e=>e.status===502);
 await store.delete(id);assert.equal(calls.deleted.opts.type,'authenticated');await assert.rejects(store.download('https://evil.test/file.pdf'));
});
test('missing configuration and provider failures fail without producing file URLs or successful uploads',async()=>{
 await assert.rejects(createAttachmentStore({cfg:{}}).upload(parseAttachment(body())),e=>e.status===503);
 const sdk={config(){},uploader:{upload_stream:(_o,cb)=>({end:()=>cb(new Error('Provider detail'))}),destroy:async()=>({result:'ok'})}};
 await assert.rejects(createAttachmentStore({sdk,cfg:{cloudName:'demo',apiKey:'k',apiSecret:'s'}}).upload(parseAttachment(body())),e=>e.status===502&&!e.message.includes('Provider detail'));
});
