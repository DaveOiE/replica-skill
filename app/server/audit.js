import { createHash } from 'node:crypto';
import { nowIso, newId, transaction } from './db.js';

export const GENESIS = '0'.repeat(64);
// 'tokenId' is a random id that names a token (so an incident can say which one); the token itself and its hash are never recorded.
const SECRET_KEY = /pass(word)?|token(?!_?id$)|secret|hash|signing_?key|cert_?pem|private/i;

/** Remove anything secret-looking before it can reach the audit trail. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]));
  }
  return value;
}

/**
 * The audit trail records ids and field NAMES, never text a person typed. Deny by default: only numbers, booleans, ids, dates
 * and a short list of fixed-vocabulary keys keep their value; every other field keeps its name and the value becomes NOT_RECORDED.
 */
export const NOT_RECORDED = '[not recorded]';
const ENUM_KEYS = new Set(['status', 'role', 'visibility', 'kind', 'source', 'attempted']);
const ID_KEY = /(^id$|Id$|_id$)|^(project|task|comment|dependsOn|section|user|form)$/;
const DATE_KEY = /(Date|At|_at)$/;
const isoDate = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;
const code = /^[a-z_:]{1,32}$/;
export function fieldsOnly(value) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? (code.test(v) ? v : NOT_RECORDED) : fieldsOnly(v)));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return [k, v];
    if (Array.isArray(v)) return [k, v.every((x) => typeof x === 'string' && code.test(x)) ? v : NOT_RECORDED];
    if (typeof v === 'object') return [k, fieldsOnly(v)];
    if (typeof v === 'string') {
      if (ID_KEY.test(k) && /^[\w-]{1,64}$/.test(v)) return [k, v];
      if (ENUM_KEYS.has(k) && code.test(v)) return [k, v];
      if (DATE_KEY.test(k) && isoDate.test(v)) return [k, v];
    }
    return [k, NOT_RECORDED];
  }));
}

const fieldsOf = (e) => JSON.stringify([e.prevHash, e.workspaceId, e.ts, e.actorId ?? null, e.actorKind, e.action,
  e.targetType ?? null, e.targetId ?? null, e.summary, e.beforeJson ?? null, e.afterJson ?? null, e.ip ?? null, e.requestId ?? null]);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Append one event to its workspace's chain. Call inside the same transaction as the change. */
export function appendAudit(db, ev) {
  const prev = db.prepare('select hash from audit_events where workspace_id = ? order by seq desc limit 1').get(ev.workspaceId);
  const row = {
    prevHash: prev ? prev.hash : GENESIS, workspaceId: ev.workspaceId, ts: ev.ts || nowIso(),
    actorId: ev.actorId ?? null, actorKind: ev.actorKind, action: ev.action,
    targetType: ev.targetType ?? null, targetId: ev.targetId ?? null, summary: ev.summary,
    beforeJson: ev.before === undefined ? null : JSON.stringify(fieldsOnly(redact(ev.before))),
    afterJson: ev.after === undefined ? null : JSON.stringify(fieldsOnly(redact(ev.after))),
    ip: ev.ip ?? null, requestId: ev.requestId ?? null,
  };
  row.hash = sha256(fieldsOf(row));
  db.prepare(`insert into audit_events(workspace_id,ts,actor_id,actor_kind,action,target_type,target_id,summary,
      before_json,after_json,ip,request_id,prev_hash,hash) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.workspaceId, row.ts, row.actorId, row.actorKind, row.action, row.targetType, row.targetId, row.summary,
      row.beforeJson, row.afterJson, row.ip, row.requestId, row.prevHash, row.hash);
  return row.hash;
}

/** Recompute the whole chain for a workspace. Returns {ok, checked, brokenAtSeq}. */
export function verifyChain(db, workspaceId) {
  let prev = GENESIS, checked = 0;
  for (const r of db.prepare('select * from audit_events where workspace_id = ? order by seq').all(workspaceId)) {
    const expected = sha256(fieldsOf({ prevHash: prev, workspaceId: r.workspace_id, ts: r.ts, actorId: r.actor_id,
      actorKind: r.actor_kind, action: r.action, targetType: r.target_type, targetId: r.target_id, summary: r.summary,
      beforeJson: r.before_json, afterJson: r.after_json, ip: r.ip, requestId: r.request_id }));
    if (r.prev_hash !== prev || r.hash !== expected) return { ok: false, checked, brokenAtSeq: r.seq };
    prev = r.hash; checked++;
  }
  return { ok: true, checked, brokenAtSeq: null };
}

/**
 * The only write path. Runs fn (synchronous) and records the audit row in the same
 * transaction: both happen or neither does. `meta` is an object, or a function of fn's result.
 * ctx = { db, actor: { userId, workspaceId, kind } | null, ip, requestId }
 */
export function mutate(ctx, meta, fn) {
  return transaction(ctx.db, () => {
    const result = fn();
    const m = typeof meta === 'function' ? meta(result) : meta;
    appendAudit(ctx.db, {
      workspaceId: m.workspaceId ?? ctx.actor?.workspaceId ?? 'none',
      actorId: ctx.actor?.userId ?? null, actorKind: ctx.actor?.kind ?? 'anonymous',
      action: m.action, targetType: m.targetType, targetId: m.targetId, summary: m.summary,
      before: m.before, after: m.after, ip: ctx.ip, requestId: ctx.requestId,
    });
    return result;
  });
}
