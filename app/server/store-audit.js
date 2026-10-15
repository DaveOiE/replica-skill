// Data access for the audit log screen. Nothing secret can leave this module: rows are already redacted when written, and everything is scrubbed again here.
import { redact } from './audit.js';

const TOKEN = /dsk_[A-Za-z0-9_-]{20,}/g, HASH = /scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]{10,}/g, BEARER = /Bearer\s+\S+/gi;
export const scrub = (s) => (s == null ? s : String(s).replace(TOKEN, '[redacted]').replace(HASH, '[redacted]').replace(BEARER, '[redacted]'));
const parse = (j) => { if (j == null) return null; try { return redact(JSON.parse(scrub(j))); } catch { return '[unreadable]'; } };
const KINDS = ['system', 'anonymous', 'scim'];

function where(ws, f, beforeSeq) {
  const c = ['e.workspace_id = ?'], a = [ws];
  if (f.who) { if (f.who.startsWith('kind:')) { c.push('e.actor_kind = ?'); a.push(f.who.slice(5)); } else { c.push('e.actor_id = ?'); a.push(f.who); } }
  if (f.action) { c.push('e.action = ?'); a.push(f.action); }
  if (f.from) { c.push('e.ts >= ?'); a.push(`${f.from}T00:00:00.000Z`); }
  if (f.to) { c.push('e.ts < ?'); a.push(new Date(Date.parse(`${f.to}T00:00:00.000Z`) + 86400000).toISOString()); }   // the whole of the "to" day
  if (beforeSeq) { c.push('e.seq < ?'); a.push(beforeSeq); }
  return { sql: c.join(' and '), args: a };
}
export const validWho = (w) => !w || KINDS.some((k) => w === `kind:${k}`) || /^[0-9a-f-]{36}$/.test(w);

export function listAudit(db, ws, f, beforeSeq, limit) {
  const w = where(ws, f, beforeSeq);
  const rows = db.prepare(`select e.*, u.name as actor_name from audit_events e left join users u on u.id = e.actor_id where ${w.sql} order by e.seq desc limit ?`).all(...w.args, limit + 1);
  return { rows: rows.slice(0, limit).map(shape), more: rows.length > limit };
}
export const countAudit = (db, ws, f) => { const w = where(ws, f); return db.prepare(`select count(*) n from audit_events e where ${w.sql}`).get(...w.args).n; };

export function filterOptions(db, ws) {
  return {
    actors: db.prepare(`select distinct e.actor_id as id, u.name, e.actor_kind as kind from audit_events e join users u on u.id = e.actor_id where e.workspace_id = ? order by u.name`).all(ws).map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
    kinds: db.prepare('select distinct actor_kind as kind from audit_events where workspace_id = ? and actor_id is null order by actor_kind').all(ws).map((r) => r.kind),
    actions: db.prepare('select distinct action from audit_events where workspace_id = ? order by action').all(ws).map((r) => r.action),
  };
}

/** What the screen and the CSV may show. The hash chain fields are internal and never returned. */
function shape(r) {
  return { seq: r.seq, ts: r.ts, actor: { id: r.actor_id, name: r.actor_name, kind: r.actor_kind }, action: r.action, target_type: r.target_type, target_id: r.target_id,
    summary: scrub(r.summary), before: parse(r.before_json), after: parse(r.after_json), ip: r.ip, request_id: r.request_id };
}

const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;                       // a spreadsheet must never run a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV of the log. Values before and after a change are NOT included, only the names of the fields that changed. */
export function toCsv(rows) {
  const head = ['seq', 'time_utc', 'who', 'kind', 'action', 'target_type', 'target_id', 'summary', 'changed_fields', 'ip', 'request_id'];
  const body = rows.map((r) => [r.seq, r.ts, r.actor.name || '', r.actor.kind, r.action, r.target_type, r.target_id, r.summary, r.after && typeof r.after === 'object' ? Object.keys(r.after).join(';') : '', r.ip, r.request_id].map(cell).join(','));
  return [head.join(','), ...body].join('\r\n') + '\r\n';
}
