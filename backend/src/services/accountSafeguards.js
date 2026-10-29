import {HttpError} from '../middleware/error.js';
import {hasPermission} from './permissions.js';
export async function protectPrivilegedAccount(db,actor,userId){
 if(hasPermission(actor,'access.manage'))return;
 const {rows}=await db.query('SELECT 1 FROM access_grants WHERE user_id=$1 AND revoked_at IS NULL LIMIT 1',[userId]);
 if(rows.length)throw new HttpError(403,'Only Admin can change privileged account login details or activation','forbidden');
}
export function accountConflict(error){
 if(error.constraint==='last_active_admin')return new HttpError(409,error.message,'last_active_admin');
 if(error.code==='40P01'||error.code==='40001')return new HttpError(409,'Account access changed concurrently. Refresh and try again.','conflict');
 return error;
}
