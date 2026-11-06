import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { requirePermission } from '../middleware/auth.js';
import { HttpError, wrap } from '../middleware/error.js';
import { approvalWrap } from '../middleware/approval.js';
import { validate, v } from '../middleware/validate.js';
import { audit, diffFields } from '../services/audit.js';
import { validationError } from '../services/dbErrors.js';
import { idParams } from '../services/hrSchemas.js';
import { likePattern, pageOffset, pageResult, pageSchema } from '../services/sql.js';
import { structureBody, structureResult } from '../services/appraisalStructure.js';
import { templateTargets, toAppraisalTemplate } from '../services/appraisalTemplates.js';

const router = Router();
router.use(requirePermission('appraisals.configure'));

const scopes = Object.keys(templateTargets);
const templateBody = {
  name: v.string({ required: true, max: 120 }),
  scope: v.enum({ required: true, values: ['company', ...scopes] }),
  targetId: v.int({ nullable: true, min: 1 }),
};
const targetCheck = (req, _res, next) => {
  const { scope, targetId } = req.body;
  if ((scope === 'company') !== (targetId == null)) {
    return next(validationError({ targetId: scope === 'company' ? 'Company templates have no target' : 'Choose a target' }));
  }
  next();
};

router.get('/targets', validate({ ...pageSchema, scope: v.enum({ required: true, values: scopes }), search: v.string({ max: 120 }) }, 'query'),
  wrap(async (req, res) => {
    const filters = req.query;
    const { from, label } = templateTargets[filters.scope];
    const { rows: [result] } = await query(`
      WITH choices AS (SELECT t.id, ${label} AS name ${from} WHERE ${label} ILIKE $1),
      selected AS (SELECT * FROM choices ORDER BY name,id LIMIT $2 OFFSET $3)
      SELECT (SELECT count(*)::int FROM choices) AS total,
        COALESCE((SELECT json_agg(selected ORDER BY name,id) FROM selected),'[]'::json) AS items
    `, [likePattern(filters.search ?? ''), filters.pageSize, pageOffset(filters)]);
    res.json({ ...pageResult(result.items, filters, result.total), scope: filters.scope });
  }));

router.get('/', validate(pageSchema, 'query'), wrap(async (req, res) => {
  const filters = req.query;
  const { rows: [result] } = await query(`
    WITH selected AS (
      SELECT t.*, COALESCE(gd.name || ' · ' || gp.name || ' · ' || g.name,
        pd.name || ' · ' || p.name, d.name) AS target_name
      FROM appraisal_templates t
      LEFT JOIN departments d ON d.id=t.department_id
      LEFT JOIN positions p ON p.id=t.position_id LEFT JOIN departments pd ON pd.id=p.department_id
      LEFT JOIN position_job_grades g ON g.id=t.job_grade_id LEFT JOIN positions gp ON gp.id=g.position_id
      LEFT JOIN departments gd ON gd.id=gp.department_id
      ORDER BY lower(t.name),t.id LIMIT $1 OFFSET $2
    )
    SELECT (SELECT count(*)::int FROM appraisal_templates) AS total,
      COALESCE((SELECT json_agg(selected ORDER BY lower(name),id) FROM selected),'[]'::json) AS items
  `, [filters.pageSize, pageOffset(filters)]);
  res.json(pageResult(result.items.map(toAppraisalTemplate), filters, result.total));
}));

router.get('/:id/structure', validate(idParams, 'params'), wrap(async (req, res) => {
  const { rows: [row] } = await query(`SELECT t.version, COALESCE(s.categories,'[]'::jsonb) AS categories,
      COALESCE(r.brackets,'[]'::jsonb) AS brackets
    FROM appraisal_templates t LEFT JOIN appraisal_template_structures s ON s.template_id=t.id
    LEFT JOIN appraisal_template_ratings r ON r.template_id=t.id WHERE t.id=$1`, [req.params.id]);
  if (!row) throw new HttpError(404, 'Appraisal template not found', 'not_found');
  res.json(structureResult(row.version, row.categories, row.brackets));
}));

router.put('/:id/structure', validate(idParams, 'params'), structureBody, approvalWrap(async (req, res) => {
  const { version, categories, brackets } = req.body;
  const { id } = req.params;
  const result = await withTransaction(async db => {
    const { rows: [before] } = await db.query('SELECT version FROM appraisal_templates WHERE id=$1 FOR UPDATE', [id]);
    if (!before) throw new HttpError(404, 'Appraisal template not found', 'not_found');
    if (before.version !== version) throw new HttpError(409, 'Template changed. Reopen it before saving.', 'conflict');
    await db.query(`INSERT INTO appraisal_template_structures(template_id,categories) VALUES($1,$2::jsonb)
      ON CONFLICT(template_id) DO UPDATE SET categories=EXCLUDED.categories`, [id, JSON.stringify(categories)]);
    if (brackets !== undefined) {
      await db.query(`INSERT INTO appraisal_template_ratings(template_id,brackets) VALUES($1,$2::jsonb)
        ON CONFLICT(template_id) DO UPDATE SET brackets=EXCLUDED.brackets`, [id, JSON.stringify(brackets)]);
    }
    const { rows: [rating] } = await db.query('SELECT brackets FROM appraisal_template_ratings WHERE template_id=$1', [id]);
    const { rows: [saved] } = await db.query('UPDATE appraisal_templates SET version=version+1 WHERE id=$1 RETURNING version', [id]);
    const result = structureResult(saved.version, categories, rating?.brackets ?? []);
    await audit(db, { actorId: req.user.id, action: 'appraisal.template.structure.update',
      entityType: 'appraisal_template', entityId: id, details: {
        categoryCount: categories.length, criterionCount: categories.reduce((count, category) => count + category.criteria.length, 0),
        totalWeight: result.weights.total, weightsReady: result.weights.ready,
        bracketCount: result.brackets.length, ratingsReady: result.ratings.ready,
      } });
    return result;
  });
  res.json(result);
}));

function saveTemplate(editing) {
  return approvalWrap(async (req, res) => {
    const { id } = req.params;
    const { name, scope, targetId, version } = req.body;
    const item = await withTransaction(async db => {
      const before = editing ? (await db.query('SELECT * FROM appraisal_templates WHERE id=$1 FOR UPDATE', [id])).rows[0] : null;
      if (editing && !before) throw new HttpError(404, 'Appraisal template not found', 'not_found');
      if (before && before.version !== version) throw new HttpError(409, 'Template changed. Reopen it before saving.', 'conflict');
      const target = templateTargets[scope];
      if (target && !(await db.query(`SELECT 1 FROM ${target.table} WHERE id=$1 FOR KEY SHARE`, [targetId])).rowCount) {
        throw validationError({ targetId: 'Choose an existing target' });
      }
      const args = [name, ...scopes.map(key => scope === key ? targetId : null)];
      const { rows: [saved] } = editing
        ? await db.query(`UPDATE appraisal_templates SET name=$1,department_id=$2,position_id=$3,job_grade_id=$4,
          version=version+1 WHERE id=$5 RETURNING *`, [...args, id])
        : await db.query('INSERT INTO appraisal_templates(name,department_id,position_id,job_grade_id) VALUES($1,$2,$3,$4) RETURNING *', args);
      const value = toAppraisalTemplate(saved);
      const details = before ? { changes: diffFields(toAppraisalTemplate(before), value, ['name','scope','targetId']) }
        : { name, scope, targetId: targetId ?? null };
      await audit(db, { actorId: req.user.id, action: editing ? 'appraisal.template.update' : 'appraisal.template.create',
        entityType: 'appraisal_template', entityId: value.id, details });
      return value;
    });
    res.status(editing ? 200 : 201).json(item);
  });
}
router.delete('/:id', validate(idParams, 'params'), approvalWrap(async (req, res) => {
  await withTransaction(async db => {
    const { rows: [removed] } = await db.query('DELETE FROM appraisal_templates WHERE id=$1 RETURNING *', [req.params.id]);
    if (!removed) throw new HttpError(404, 'Appraisal template not found', 'not_found');
    const { id, name, scope, targetId } = toAppraisalTemplate(removed);
    await audit(db, { actorId: req.user.id, action: 'appraisal.template.delete', entityType: 'appraisal_template', entityId: id,
      details: { name, scope, targetId } });
  });
  res.sendStatus(204);
}));
router.post('/', validate(templateBody), targetCheck, saveTemplate(false));
router.patch('/:id', validate(idParams, 'params'), validate({ ...templateBody, version: v.int({ required: true, min: 1 }) }), targetCheck, saveTemplate(true));

export default router;
