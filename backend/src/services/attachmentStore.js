import crypto from 'node:crypto';
import {config} from '../config.js';
import {HttpError} from '../middleware/error.js';
import {MAX_ATTACHMENT_BYTES} from './employeeAttachments.js';
const ID=/^natra\/employee-files\/\d{4}\/[A-Za-z0-9_-]{24}\.(pdf|doc|docx|xls|xlsx|jpg|jpeg|png|gif|webp)$/;
export function createAttachmentStore({sdk,cfg=config.cloudinary,now=Date.now,random=()=>crypto.randomBytes(18).toString('base64url'),fetcher=fetch}={}){
 let ready;
 const client=async()=>{
  if(!cfg.cloudName||!cfg.apiKey||!cfg.apiSecret)throw new HttpError(503,'File storage is not configured','storage_unavailable');
  ready??=(async()=>{const v=sdk??(await import('cloudinary')).v2;v.config({cloud_name:cfg.cloudName,api_key:cfg.apiKey,api_secret:cfg.apiSecret,secure:true});return v;})();return ready;
 };
 const check=id=>{if(!ID.test(id))throw new Error('Invalid attachment storage id');};
 return {
  async upload(file){
   const v=await client(),id=`natra/employee-files/${new Date(now()).getUTCFullYear()}/${random()}.${file.extension}`;check(id);
   try{await new Promise((resolve,reject)=>v.uploader.upload_stream({public_id:id,resource_type:'raw',type:'authenticated',overwrite:false,unique_filename:false,timeout:30000},(e,r)=>e||!r?reject(e||new Error('Empty upload result')):resolve(r)).end(file.bytes));}
   catch{await v.uploader.destroy(id,{resource_type:'raw',type:'authenticated',invalidate:true}).catch(()=>{});throw new HttpError(502,'Could not store the file. Please try again.','storage_failed');}return id;
  },
  async download(id){
   check(id);const v=await client();
   const url=v.utils.private_download_url(id,undefined,{type:'authenticated',resource_type:'raw',attachment:true,expires_at:Math.floor(now()/1000)+60});
   try{
    const r=await fetcher(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('File download failed');
    const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>MAX_ATTACHMENT_BYTES)throw new Error('Stored file too large');chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks);
   }catch{throw new HttpError(502,'Could not download the file. Please try again.','storage_failed');}
  },
  async delete(id){check(id);const v=await client();const r=await v.uploader.destroy(id,{resource_type:'raw',type:'authenticated',invalidate:true});if(!['ok','not found'].includes(r?.result))throw new HttpError(502,'Could not clean up the file','storage_failed');}
 };
}
export const attachmentStore=createAttachmentStore();
