import { withAccess, loadAccessRoles } from '../services/accessGrants.js';
import crypto from 'node:crypto';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requireEmployee } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { validate, v } from '../middleware/validate.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { hashPassword, passwordProblem, verifyPassword } from '../services/password.js';
import { audit } from '../services/audit.js';
export const passwordChangeLimit=createLimiter({windowMs:15*60_000,max:5});
const router=Router();
router.use(requireEmployee);
const field=()=>v.string({required:true,trim:false,max:256});
router.post('/',validate({currentPassword:field(),newPassword:field(),confirmPassword:field()}),wrap(async(req,res)=>{
  const key=String(req.user.id),blocked=passwordChangeLimit.check(key);
  if(blocked.blocked){res.set('Retry-After',String(blocked.retryAfterSec));throw new HttpError(429,'Too many failed password attempts. Try again later.','rate_limited');}
  const b=req.body,problem=passwordProblem(b.newPassword);
  if(problem)throw new HttpError(400,problem,'validation',{fields:{newPassword:problem}});
  if(b.newPassword!==b.confirmPassword)throw new HttpError(400,'New passwords do not match','validation',{fields:{confirmPassword:'Passwords must match'}});
  const {rows:[user]}=await query('SELECT id,role,email,full_name,password_hash,must_change_password FROM users WHERE id=$1',[req.user.id]);
  if(!user || !await verifyPassword(b.currentPassword,user.password_hash)){
    passwordChangeLimit.fail(key);
    throw new HttpError(400,'Current password is incorrect','invalid_password',{fields:{currentPassword:'Current password is incorrect'}});
  }
  if(await verifyPassword(b.newPassword,user.password_hash))throw new HttpError(400,'Choose a password different from your temporary or current password','validation',{fields:{newPassword:'Use a different password'}});
  const hash=await hashPassword(b.newPassword),csrfToken=crypto.randomBytes(32).toString('base64url');
  await withTransaction(async db=>{
    const {rows:[current]}=await db.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[user.id]);
    if(current?.password_hash!==user.password_hash)throw new HttpError(409,'Your password changed in another session. Sign in again.','conflict');
    await db.query('UPDATE users SET password_hash=$2,must_change_password=false WHERE id=$1',[user.id,hash]);
    await db.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2',[user.id,req.session.id]);
    const kept=await db.query('UPDATE sessions SET csrf_token=$2 WHERE id=$1 RETURNING id',[req.session.id,csrfToken]);
    if(!kept.rowCount)throw new HttpError(401,'Your session ended. Sign in again.','unauthenticated');
    await audit(db,{actorId:user.id,action:'auth.password.change',entityType:'user',entityId:user.id,details:{temporaryPasswordReplaced:user.must_change_password}});
  });
  passwordChangeLimit.reset(key);
  res.json({user:withAccess({id:Number(user.id),role:user.role,email:user.email,fullName:user.full_name,mustChangePassword:false},await loadAccessRoles({query},user.id)),csrfToken,locked:false});
}));
export default router;
