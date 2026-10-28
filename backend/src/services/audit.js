// Append-only audit trail (the table rejects UPDATE/DELETE). Pass the transaction client as `db`
// so the audit row commits or rolls back together with the change it describes.
const SENSITIVE_KEY = /pass(word)?|token|secret|hash|csrf|authorization|cookie|session|photo|selfie|api[_-]?key|credential|private[_-]?key|database[_-]?url|connection[_-]?string/i;
const MAX_DETAILS_BYTES = 8_192;

// Deep copy with secret-looking keys replaced, so credentials can never reach the log by accident.
export function redact(value, depth = 0) {
  if (depth > 6) return '[depth limit]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) =>
      [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  }
  return value;
}

export async function audit(db, { actorId = null, action, entityType, entityId = null, reason = null, details = {} }) {
  if (!action || typeof action !== 'string') throw new Error('audit: action is required');
  if (!entityType || typeof entityType !== 'string') throw new Error('audit: entityType is required');

  let json = JSON.stringify(redact(details ?? {}));
  if (Buffer.byteLength(json) > MAX_DETAILS_BYTES) json = JSON.stringify({ truncated: true });

  const { rows: [row] } = await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [actorId, action, entityType, entityId == null ? null : String(entityId), reason, json]);
  return Number(row.id);
}

// Fields (from `keys`) whose value differs, as { field: { from, to } }. Empty object = no change.
export function diffFields(before, after, keys) {
  const out = {};
  for (const k of keys) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}
