import crypto from 'node:crypto';
import {config} from '../config.js';
import {HttpError} from '../middleware/error.js';
import {hasPermission} from './permissions.js';
import {withAccess,loadAccessRoles} from './accessGrants.js';
const key=crypto.createHash('sha256').update('change-approval:'+config.sessionSecret).digest();
export function encrypt(body){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(JSON.stringify(body)),c.final(),c.getAuthTag()]).toString('base64');}
export function decrypt(text){try{const b=Buffer.from(text,'base64'),c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString());}catch{throw new HttpError(409,'This request can no longer be read. Cancel it and submit again.','unreadable_request');}}
export const dedupe=(method,path,body)=>crypto.createHmac('sha256',key).update(method+path+JSON.stringify(body)).digest('hex');
const hidden=/password|token|secret|hash|csrf|cookie|authorization|credential|key/i;
export function preview(body,depth=0){if(depth>6)return '[nested value omitted]';if(Array.isArray(body))return body.map(v=>preview(v,depth+1));if(body&&typeof body==='object')return Object.fromEntries(Object.entries(body).map(([k,v])=>[k,hidden.test(k)?'[protected]':preview(v,depth+1)]));return typeof body==='string'?body.slice(0,5000):body;}
export async function fingerprint(db,policy){
 const parts=[];
 for(const table of policy.tables){
  // Exclude login/session bookkeeping from the user identity fingerprint.
  const row=table==='users'?"jsonb_build_object('id',id,'email',email,'username',username,'fullName',full_name,'role',role,'active',is_active,'password',password_hash,'mustChangePassword',must_change_password)":'to_jsonb(t)';
  const {rows:[r]}=await db.query(`SELECT md5(COALESCE(string_agg(md5((${row})::text),'' ORDER BY md5((${row})::text)),'')) AS digest FROM ${table} t`);
  parts.push(r.digest);
 }
 return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
}
export async function currentUser(db,id){
 const {rows:[u]}=await db.query('SELECT id,role,username,email,full_name,is_active,must_change_password FROM users WHERE id=$1',[id]);
 if(!u||!u.is_active||u.must_change_password)throw new HttpError(409,'Requester must have an active account and completed password setup','requester_unavailable');
 const {rows}=await db.query("SELECT 1 FROM employees WHERE user_id=$1 AND status<>'active'",[id]);if(rows.length)throw new HttpError(409,'Requester is no longer active','requester_unavailable');
 return withAccess({id:Number(u.id),role:u.role,username:u.username,email:u.email,fullName:u.full_name},await loadAccessRoles(db,id));
}
export const canReview=(user,row)=>user.id!==Number(row.requester_id)&&hasPermission(user,row.permission)&&
 (hasPermission(user,'access.manage')||user.accessRoles?.includes(row.department));
