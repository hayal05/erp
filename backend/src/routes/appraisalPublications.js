import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { HttpError, wrap } from '../middleware/error.js';
import { approvalWrap } from '../middleware/approval.js';
import { validate, v } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { idParams } from '../services/hrSchemas.js';
import { pageOffset, pageResult, pageSchema } from '../services/sql.js';
import { toAppraisalTemplate } from '../services/appraisalTemplates.js';
import { structureResult } from '../services/appraisalStructure.js';

const router = Router({ mergeParams: true });
const versionRule = v.int({ required: true, min: 1 });

router.get('/', validate(idParams, 'params'), validate(pageSchema, 'query'), wrap(async (req, res) => {
  const { rows: [result] } = await query(`
    WITH selected AS (
      SELECT version, published_at AS "publishedAt", snapshot->>'name' AS name
      FROM appraisal_template_publications WHERE template_id=$1
      ORDER BY version DESC LIMIT $2 OFFSET $3
    )
    SELECT (SELECT count(*)::int FROM appraisal_template_publications WHERE template_id=$1) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY version DESC) FROM selected),'[]'::json) AS items
  `, [req.params.id, req.query.pageSize, pageOffset(req.query)]);
  res.json(pageResult(result.items, req.query, result.total));
}));

router.get('/:version', validate({ ...idParams, version: versionRule }, 'params'), wrap(async (req, res) => {
  const { rows: [row] } = await query(`SELECT snapshot, published_at AS "publishedAt"
    FROM appraisal_template_publications WHERE template_id=$1 AND version=$2`, [req.params.id, req.params.version]);
  if (!row) throw new HttpError(404, 'Published version not found', 'not_found');
  res.json({ ...row.snapshot, publishedAt: row.publishedAt });
}));

router.post('/', validate(idParams, 'params'), validate({ version: versionRule }), approvalWrap(async (req, res) => {
  const { id } = req.params;
  const { version } = req.body;
  const result = await withTransaction(async db => {
    // Serialize publication across targets. Lock before taking the draft row lock.
    await db.query('LOCK TABLE appraisal_template_publications IN SHARE ROW EXCLUSIVE MODE');
    const { rows: [draft] } = await db.query('SELECT * FROM appraisal_templates WHERE id=$1 FOR UPDATE', [id]);
    if (!draft) throw new HttpError(404, 'Appraisal template not found', 'not_found');
    if (draft.version !== version) throw new HttpError(409, 'Draft changed. Reopen it before publishing.', 'conflict');
    const { rows: [existing] } = await db.query('SELECT 1 FROM appraisal_template_publications WHERE template_id=$1 AND version=$2', [id, version]);
    if (existing) throw new HttpError(409, 'This version is already published.', 'conflict');
    const { rows: [data] } = await db.query(`SELECT COALESCE(s.categories,'[]'::jsonb) AS categories,
      COALESCE(r.brackets,'[]'::jsonb) AS brackets FROM appraisal_templates t
      LEFT JOIN appraisal_template_structures s ON s.template_id=t.id
      LEFT JOIN appraisal_template_ratings r ON r.template_id=t.id WHERE t.id=$1`, [id]);
    const structure = structureResult(version, data.categories, data.brackets);
    if (!structure.weights.ready || !structure.ratings.ready) {
      throw new HttpError(422, 'Complete the category weights, criterion weights, and rating brackets before publishing.', 'incomplete_template');
    }
    const template = toAppraisalTemplate(draft);
    const { rows: [conflict] } = await db.query(`SELECT 1 FROM (
      SELECT DISTINCT ON (template_id) snapshot FROM appraisal_template_publications
      WHERE template_id<>$1 ORDER BY template_id,version DESC
    ) latest WHERE snapshot->>'scope'=$2 AND (snapshot->>'targetId') IS NOT DISTINCT FROM $3::text LIMIT 1`,
    [id, template.scope, template.targetId]);
    if (conflict) throw new HttpError(409, 'Another published template already covers this target.', 'template_conflict');
    const snapshot = { ...template, categories: data.categories, brackets: data.brackets };
    const { rows: [saved] } = await db.query(`INSERT INTO appraisal_template_publications(template_id,version,snapshot,published_by)
      VALUES($1,$2,$3::jsonb,$4) RETURNING version,published_at AS "publishedAt"`, [id, version, JSON.stringify(snapshot), req.user.id]);
    await audit(db, { actorId: req.user.id, action: 'appraisal.template.publish', entityType: 'appraisal_template',
      entityId: id, details: { version, scope: template.scope, targetId: template.targetId } });
    return saved;
  });
  res.status(201).json(result);
}));

export default router;
