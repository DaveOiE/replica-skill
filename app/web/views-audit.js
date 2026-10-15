// Audit log screen (owners and admins). Filters who, action and dates; load-more paging; CSV export through the server.
import { h, select, field, toast } from './dom.js';
import { api } from './api.js';
import { S } from './strings.js';
import { pageTitle } from '/shared/titles.js';

const KIND_LABEL = { system: S.auditSystem, anonymous: S.auditAnonymous, scim: S.auditScim };
const keep = { who: '', action: '', from: '', to: '' }; // filters survive a refresh of the screen, not a reload of the page

const query = (f, extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v)).toString();

async function download(filters) {
  try {
    const res = await fetch('/api/v1/audit/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))) });
    if (!res.ok) { let m = S.networkError; try { m = (await res.json()).error || m; } catch { /* not json */ } return toast(m, true); }
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: 'audit-log.csv' });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast(S.auditExported);
  } catch { toast(S.networkError, true); }
}

export async function auditView(ctx) {
  document.title = pageTitle('S28');
  if (!['owner', 'admin'].includes(ctx.session.role)) return [h('div', { class: 'empty' }, h('p', {}, S.notFound))];
  const first = await api('GET', `/api/v1/audit?${query(keep)}`);
  if (first.status !== 200) return [h('div', { class: 'empty' }, h('p', {}, first.data?.error || S.notFound))];
  const { options } = first.data;
  const whoOpts = [['', S.auditAnyone], ...options.actors.map((a) => [a.id, a.name]), ...options.kinds.map((k) => [`kind:${k}`, KIND_LABEL[k] || k])];
  const who = select('au-who', S.auditWho, whoOpts, keep.who), act = select('au-action', S.auditAction, [['', S.auditAnyAction], ...options.actions.map((a) => [a, a])], keep.action);
  const from = field('au-from', S.auditFrom, { type: 'date', value: keep.from }), to = field('au-to', S.auditTo, { type: 'date', value: keep.to });
  const read = () => ({ who: who.querySelector('select').value, action: act.querySelector('select').value, from: from.querySelector('input').value, to: to.querySelector('input').value });
  const list = h('ul', { class: 'list audit-list', 'aria-label': S.auditHeading });
  const more = h('button', { class: 'btn btn-secondary', type: 'button', hidden: true }, S.auditMore);
  const empty = h('p', { class: 'muted', hidden: true }, S.auditEmpty);
  const row = (e) => h('li', { class: 'row audit-row' },
    h('div', { class: 'row-main' }, h('strong', {}, e.action), ` ${e.summary || ''}`),
    h('div', { class: 'muted' }, `${e.ts.slice(0, 19).replace('T', ' ')} UTC · ${e.actor.name || KIND_LABEL[e.actor.kind] || e.actor.kind}${e.target_type ? ` · ${e.target_type}` : ''}`));
  let cursor = null, shown = 0;
  const add = (d) => { d.events.forEach((e) => list.append(row(e))); shown += d.events.length; cursor = d.next_before; more.hidden = !cursor; empty.hidden = shown > 0; };
  add(first.data);
  more.onclick = async () => { const f = read(); const r = await api('GET', `/api/v1/audit?${query(f, { before: cursor })}`); r.status === 200 ? add(r.data) : toast(r.data?.error || S.networkError, true); };
  const form = h('form', { class: 'card filters', onsubmit: (e) => { e.preventDefault(); Object.assign(keep, read()); ctx.refresh(); } },
    who, act, from, to, h('button', { class: 'btn btn-primary', type: 'submit' }, S.auditApply),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => download(read()) }, S.auditExport));
  return [h('h1', {}, S.auditHeading), h('p', { class: 'muted' }, S.auditIntro), form, list, empty, more];
}
