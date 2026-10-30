import {approvalWrap as wrap} from '../middleware/approval.js';
import { hasPermission } from '../services/permissions.js';
import { Router } from 'express';
import { withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { requirePermission } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import { HttpError } from '../middleware/error.js';
import { validate, v } from '../middleware/validate.js';
import { pageSchema, pageOffset, pageResult } from '../services/sql.js';
import { idParams } from '../services/hrSchemas.js';
import { companyDate } from '../services/attendance.js';
import { audit } from '../services/audit.js';
const router = Router();
router.use(noStore, requirePermission('announcements.read'));
const statuses = ['draft','published','archived'];
const schema = { title: v.string({ required: true, min: 1, max: 160 }), body: v.string({ required: true, min: 1, max: 5000 }),
  status: v.enum({ required: true, values: statuses }), expiresOn: v.date({ nullable: true }) };
const columns = `id,title,body,status,to_char(expires_on,'YYYY-MM-DD') AS "expiresOn", version,
  to_char(published_at AT TIME ZONE $1,'YYYY-MM-DD HH24:MI') AS "publishedAt",
  (expires_on IS NOT NULL AND expires_on < (now() AT TIME ZONE $1)::date) AS expired`;
const output = r => ({ ...r, id: Number(r.id) });
const ensureExpiry = b => {
  if (b.status === 'published' && b.expiresOn && b.expiresOn < companyDate())
    throw new HttpError(422,'Choose today or a future expiry date before publishing','validation',{fields:{expiresOn:'Expiry cannot be in the past'}});
};
router.get('/', validate({ ...pageSchema, status: v.enum({ values: statuses }) }, 'query'), wrap(async (req,res) => {
  // Employee query parameters can never widen visibility to drafts, archived or expired notices.
  const employee = !hasPermission(req.user,'announcements.admin_read');
  const where = employee ? "WHERE status='published' AND (expires_on IS NULL OR expires_on >= (now() AT TIME ZONE $1)::date)"
    : req.query.status ? 'WHERE status=$2' : '';
  const base = [config.company.timezone, ...(!employee && req.query.status ? [req.query.status] : [])];
  const result = await withTransaction(async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await db.query(`SELECT ${columns} FROM announcements ${where}
      ORDER BY ${employee ? 'published_at' : 'updated_at'} DESC,id DESC LIMIT $${base.length+1} OFFSET $${base.length+2}`,
    [...base, req.query.pageSize, pageOffset(req.query)]);
    // Keep $1 typed even when the HR filter doesn't otherwise reference the timezone.
    const { rows: [count] } = await db.query(`SELECT count(*)::int AS total FROM announcements ${where || 'WHERE true'} AND $1::text IS NOT NULL`,base);
    return pageResult(rows.map(output),req.query,count.total);
  });
  res.json(result);
}));
router.post('/', requirePermission('announcements.manage'), validate(schema), wrap(async (req,res) => {
  const b=req.body; ensureExpiry(b);
  const saved=await withTransaction(async db => {
    const {rows:[r]}=await db.query(`INSERT INTO announcements(title,body,status,expires_on,published_at,created_by_user_id)
      VALUES($1,$2,$3,$4,CASE WHEN $3='published' THEN now() ELSE NULL END,$5) RETURNING id`,
    [b.title,b.body,b.status,b.expiresOn ?? null,req.user.id]);
    await audit(db,{actorId:req.user.id,action:'announcement.create',entityType:'announcement',entityId:r.id,details:{title:b.title,status:b.status}});
    return (await db.query(`SELECT ${columns} FROM announcements WHERE id=$2`,[config.company.timezone,r.id])).rows[0];
  });
  res.status(201).json(output(saved));
}));
router.put('/:id', requirePermission('announcements.manage'), validate(idParams,'params'), validate({...schema,version:v.int({required:true,min:1})}), wrap(async(req,res)=>{
  const b=req.body; ensureExpiry(b);
  const saved=await withTransaction(async db=>{
    const {rows:[before]}=await db.query('SELECT * FROM announcements WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!before) throw new HttpError(404,'Announcement not found','not_found');
    if(before.version!==b.version) throw new HttpError(409,'This announcement changed. Close the editor and refresh before trying again.','conflict');
    await db.query(`UPDATE announcements SET title=$2,body=$3,status=$4,expires_on=$5,
      published_at=CASE WHEN $4='published' AND status<>'published' THEN now() ELSE published_at END,
      version=version+1 WHERE id=$1`,[req.params.id,b.title,b.body,b.status,b.expiresOn ?? null]);
    await audit(db,{actorId:req.user.id,action:'announcement.update',entityType:'announcement',entityId:req.params.id,
      details:{title:b.title,fromStatus:before.status,toStatus:b.status}});
    return (await db.query(`SELECT ${columns} FROM announcements WHERE id=$2`,[config.company.timezone,req.params.id])).rows[0];
  });
  res.json(output(saved));
}));
export default router;
