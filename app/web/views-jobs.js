// Jobs: the register imported from a spreadsheet, and the admin-only import screen.
import { h, field, select, toast, once } from './dom.js';
import { api } from './api.js';
import { S } from './strings.js';
import { pageTitle } from '/shared/titles.js';

const today = () => new Date().toISOString().slice(0, 10);
let filter = { q: '', status: '', client: '', team: '', showClosed: false }; // kept while you move around
const fail = (res) => toast(res.data?.error || S.networkError, true);

export async function jobsView(ctx) {
  document.title = pageTitle('S38');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v) qs.set(k, String(v));
  const { status, data } = await api('GET', `/api/v1/jobs?${qs}`);
  if (status !== 200) return [h('div', { class: 'empty' }, h('p', {}, S.notFound))];
  const opts = (all, list) => [['', all], ...list.map((x) => [x, x])];
  const q = h('input', { id: 'j-q', class: 'input', type: 'search', value: filter.q, maxlength: '100' });
  const set = (k) => (v) => { filter = { ...filter, [k]: v }; ctx.refresh(); };
  const controls = h('form', { class: 'filters', role: 'search', onsubmit: (e) => { e.preventDefault(); filter = { ...filter, q: q.value.trim() }; ctx.refresh(); } },
    h('div', { class: 'field grow' }, h('label', { for: 'j-q' }, S.jobsSearch), q),
    select('j-status', S.statusFilter, opts(S.allStatuses, data.filters.statuses), filter.status, set('status')),
    select('j-client', S.clientFilter, opts(S.allClients, data.filters.clients), filter.client, set('client')),
    select('j-team', S.teamFilter, opts(S.allTeams, data.filters.teams), filter.team, set('team')),
    h('div', { class: 'field check' }, h('input', { id: 'j-closed', type: 'checkbox', checked: filter.showClosed, onchange: (e) => set('showClosed')(e.target.checked) }), h('label', { for: 'j-closed' }, S.showClosed)),
    h('button', { class: 'btn btn-secondary', type: 'submit' }, S.search));
  const admin = ['owner', 'admin'].includes(ctx.session.role);
  const rows = data.jobs.map((j) => h('li', { class: 'row job' },
    h('div', { class: 'row-main' }, h('span', { class: 'badge' }, j.jobNumber), h('a', { href: `#/p/${j.id}`, class: 'task-link' }, j.name), j.client && h('span', { class: 'muted' }, j.client)),
    j.status ? h('span', { class: `chip ${/^completed$/i.test(j.status) ? 'chip-done' : /^(lost|on hold)$/i.test(j.status) ? 'chip-blocked' : /progress/i.test(j.status) ? 'chip-in_progress' : ''}` }, j.status) : h('span', { class: 'muted' }, ''),
    h('span', { class: 'muted' }, j.ownerName || ''),
    j.dueDate ? h('span', { class: j.dueDate < today() && !j.closedDate && !/^(completed|lost)$/i.test(j.status || '') ? 'overdue' : 'muted' }, `${j.dueDate < today() && !j.closedDate && !/^(completed|lost)$/i.test(j.status || '') ? `${S.overdue}: ` : ''}${j.dueDate}`) : h('span', {}),
    j.latestNote && h('p', { class: 'row-note muted' }, j.latestNote),
    j.tags.length > 0 && h('div', { class: 'row-note' }, j.tags.map((t) => h('span', { class: 'chip' }, t)))));
  return [h('div', { class: 'page-head' }, h('h1', {}, S.jobsHeading), h('span', { class: 'muted' }, `${data.total} ${S.jobsCount}`), admin && h('a', { href: '#/import', class: 'btn btn-secondary' }, S.importJobs)),
    controls, rows.length ? h('ul', { class: 'list' }, rows) : h('div', { class: 'empty' }, h('p', {}, S.noJobs))];
}

export async function importView(ctx) {
  document.title = pageTitle('S39');
  if (!['owner', 'admin'].includes(ctx.session.role)) return [h('div', { class: 'empty' }, h('p', {}, S.notFound))];
  let csv = null; // the file text lives only in this closure, sent to the server for preview and for import, never kept
  const out = h('div', { 'aria-live': 'polite' });
  const file = h('input', { id: 'imp-file', class: 'input', type: 'file', accept: '.csv,text/csv' });
  const vis = select('imp-vis', S.importWho, [['private', S.onlyAdmins], ['workspace', S.everyone]], 'private');
  const err = (msg) => out.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, msg));
  const visValue = () => vis.querySelector('select').value;
  const showPreview = (b) => {
    const c = b.counts;
    const dl = h('dl', { class: 'counts' }, Object.entries(S.countLabels).flatMap(([k, label]) => [h('dt', {}, label), h('dd', {}, String(c[k]))]));
    const go = h('button', { class: 'btn btn-primary', type: 'button', disabled: c.toCreate + c.toUpdate === 0, onclick: async () => {
      go.disabled = true; go.textContent = S.importing;
      const r = await api('POST', '/api/v1/jobs/import', { csv, visibility: visValue() });
      if (r.status !== 200) { go.disabled = false; go.textContent = S.importConfirm; return fail(r); }
      csv = null; file.value = '';
      out.replaceChildren(h('div', { class: 'card' }, h('h2', {}, S.importDone), h('p', {}, `${r.data.counts.toCreate} new, ${r.data.counts.toUpdate} updated, ${r.data.counts.unchanged} unchanged.`), h('a', { href: '#/jobs', class: 'btn btn-primary' }, S.viewJobs)));
    } }, `${S.importConfirm} ${c.toCreate + c.toUpdate}`);
    out.replaceChildren(h('div', { class: 'card' }, h('h2', {}, S.previewHeading), dl,
      b.warnings.length > 0 && h('h3', {}, S.warningsHeading), b.warnings.length > 0 && h('ul', {}, b.warnings.map((w) => h('li', {}, `${w.kind}: ${w.count} (${S.row.toLowerCase()}s ${w.rows.join(', ')}${w.count > w.rows.length ? ', ...' : ''})`))),
      b.duplicates.length > 0 && h('p', { class: 'muted' }, `${S.duplicateNote} (${b.duplicates.map((d) => d.rows.join(' and ')).join('; ')})`),
      b.skipped.length > 0 && h('h3', {}, S.skippedRows), b.skipped.length > 0 && h('table', { class: 'data-table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, S.row), h('th', { scope: 'col' }, S.reason))),
        h('tbody', {}, b.skipped.map((s) => h('tr', {}, h('td', {}, String(s.row)), h('td', {}, s.reason))))),
      go));
  };
  const form = h('form', { class: 'card', onsubmit: once(async () => {
    const f = file.files[0];
    if (!f) return err('Choose a file first.');
    if (f.size > 3_000_000) return err('That file is too large (limit 3 MB).');
    csv = await f.text();
    const r = await api('POST', '/api/v1/jobs/import/preview', { csv });
    if (r.status !== 200) { csv = null; return err(r.data?.error || S.networkError); }
    showPreview(r.data);
  }) }, h('div', { class: 'field' }, h('label', { for: 'imp-file' }, S.chooseFile), file), vis, h('button', { class: 'btn btn-primary', type: 'submit' }, S.previewButton));
  return [h('h1', {}, S.importHeading), h('div', { class: 'banner', role: 'note' }, S.importPrivacy), h('p', { class: 'muted' }, S.importReplaces), form, out];
}
