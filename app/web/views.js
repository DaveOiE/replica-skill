// Screens after sign-in. Everything the user typed is rendered as text, never as markup.
import { h, select, field, toast, svg, once } from './dom.js';
import { api } from './api.js';
import { S } from './strings.js';
import { pageTitle } from '/shared/titles.js';

let lastDrawerTask = null; // focus moves into the drawer only when it first opens, not on every refresh
const today = () => new Date().toISOString().slice(0, 10);
const STATUS_OPTIONS = Object.entries(S.status);
const fail = (res) => toast(res.data?.error || S.networkError, true);
const notFound = () => h('div', { class: 'empty' }, h('p', {}, S.notFound));
const link = (href, text, cls) => h('a', { href, class: cls }, text);
// Tasks written by another system (source "ingestion") carry a badge and the call they came from; the inferred marker says the system guessed.
const sourceBits = (t) => t.source === 'ingestion' ? [h('span', { class: 'badge badge-service' }, S.serviceCreated),
  t.sourceCallId && h('span', { class: 'muted source-call' }, `${S.sourceCall} ${t.sourceCallId}`), t.inferred && h('span', { class: 'badge' }, S.inferred)] : [];

export async function myTasksView(ctx) {
  document.title = pageTitle('S03');
  const { data } = await api('GET', '/api/v1/me/tasks');
  const rows = data.tasks.map((t) => h('li', { class: 'row' },
    h('div', { class: 'row-main' }, link(`#/p/${t.projectId}/t/${t.id}`, t.title, 'task-link'), h('span', { class: 'muted' }, ` ${t.projectName}`)),
    h('span', { class: `chip chip-${t.status}` }, S.status[t.status]),
    t.dueDate && h('span', { class: 'muted' }, t.dueDate < today() ? `${S.overdue}: ${t.dueDate}` : t.dueDate)));
  return [h('h1', {}, S.myTasksHeading), rows.length ? h('ul', { class: 'list' }, rows) : h('div', { class: 'empty' }, h('p', {}, S.myTasksEmpty))];
}

export async function projectsView(ctx) {
  document.title = pageTitle('S35');
  const { data } = await api('GET', '/api/v1/projects');
  const canCreate = ctx.session.role !== 'view_only' && ctx.session.role !== 'guest';
  const name = h('input', { id: 'pname', class: 'input', required: true, maxlength: '120' });
  const vis = select('pvis', S.visibility, Object.entries(S.vis).filter(([k]) => k !== 'team'), 'workspace');
  const form = h('form', { class: 'card inline-form', onsubmit: once(async () => {
    const res = await api('POST', '/api/v1/projects', { name: name.value.trim(), visibility: vis.querySelector('select').value });
    if (res.status === 201) location.hash = `#/p/${res.data.id}`; else fail(res);
  }) }, h('div', { class: 'field' }, h('label', { for: 'pname' }, S.projectName), name), vis, h('button', { class: 'btn btn-primary', type: 'submit' }, S.create));
  const items = data.projects.map((p) => h('li', { class: 'row' }, h('div', { class: 'row-main' }, link(`#/p/${p.id}`, p.name, 'task-link'), p.archived && h('span', { class: 'muted' }, ' (archived)')),
    h('span', { class: 'badge' }, S.projectRoles[p.myRole])));
  return [h('h1', {}, S.projectsHeading), items.length ? h('ul', { class: 'list' }, items) : h('div', { class: 'empty' }, h('p', {}, S.noProjects)), canCreate && h('h2', {}, S.newProject), canCreate && form];
}

export async function projectView(ctx, id, taskId, view = 'list') {
  const pr = await api('GET', `/api/v1/projects/${id}`);
  if (pr.status !== 200) return [notFound()];
  const proj = pr.data, rank = { viewer: 1, commenter: 2, editor: 3, admin: 4 }[proj.myRole];
  const canEdit = rank >= 3 && !proj.archived;
  const [{ data: td }, { data: pp }] = await Promise.all([api('GET', `/api/v1/projects/${id}/tasks`), api('GET', `/api/v1/projects/${id}/people`)]);
  document.title = pageTitle(view === 'board' ? 'S05' : 'S04', proj.name);
  if (!taskId) lastDrawerTask = null;
  const people = [['', S.unassigned], ...pp.people.map((x) => [x.userId, x.name])];
  const reload = () => ctx.refresh();
  const patch = async (tid, body, quiet) => { const r = await api('PATCH', `/api/v1/tasks/${tid}`, body); if (r.status === 200) { await reload(); if (!quiet) toast(S.saved); /* after the redraw, which would otherwise remove the toast */ } else { fail(r); await reload(); } };
  const subsOf = (t) => td.tasks.filter((x) => x.parentId === t.id);

  const taskRow = (t, sub) => h('li', { class: `row${sub ? ' sub' : ''}` },
    h('div', { class: 'row-main' }, link(`#/p/${id}/t/${t.id}`, t.title, 'task-link'), t.isMilestone && h('span', { class: 'badge' }, S.milestone), sourceBits(t),
      !sub && subsOf(t).length > 0 && h('span', { class: 'muted' }, ` ${subsOf(t).filter((x) => x.status === 'done').length}/${subsOf(t).length}`)),
    select(`st-${t.id}`, `${S.statusLabel}: ${t.title}`, STATUS_OPTIONS, t.status, (v) => patch(t.id, { status: v }), !canEdit),
    select(`as-${t.id}`, `${S.assignee}: ${t.title}`, people, t.assigneeId, (v) => patch(t.id, { assigneeId: v || null }), !canEdit),
    h('div', { class: 'field' }, h('label', { for: `du-${t.id}` }, `${S.due}: ${t.title}`), h('input', { id: `du-${t.id}`, class: 'input', type: 'date', value: t.dueDate || '', disabled: !canEdit, onchange: (e) => patch(t.id, { dueDate: e.target.value || null }) }),
      t.dueDate && t.status !== 'done' && t.dueDate < today() && h('span', { class: 'overdue' }, S.overdue)));

  const sectionBlock = (sec) => {
    const mine = td.tasks.filter((t) => !t.parentId && (sec.id ? t.sectionId === sec.id : !t.sectionId));
    if (!sec.id && !mine.length) return null;
    const title = h('input', { class: 'input', placeholder: S.taskTitle, 'aria-label': `${S.taskTitle}: ${sec.name}`, maxlength: '300' });
    const add = h('form', { class: 'add-task', onsubmit: once(async () => { if (!title.value.trim()) return; const r = await api('POST', `/api/v1/projects/${id}/tasks`, { title: title.value.trim(), ...(sec.id ? { sectionId: sec.id } : {}) }); if (r.status === 201) await reload(); else fail(r); }) }, title, h('button', { class: 'btn btn-secondary', type: 'submit' }, S.addTask));
    return h('section', { class: 'section', 'aria-label': sec.name }, h('h2', {}, `${sec.name} `, h('span', { class: 'muted' }, String(mine.length))),
      mine.length ? h('ul', { class: 'list' }, mine.flatMap((t) => [taskRow(t, false), ...subsOf(t).map((s) => taskRow(s, true))])) : h('p', { class: 'muted' }, S.noTasks), canEdit && add);
  };
  // ---- board: one column per section; drag a card, or use its Move to menu (keyboard friendly)
  const move = (tid, sectionId, position) => patch(tid, { sectionId, position }, false);
  const colTasks = (secId) => td.tasks.filter((t) => !t.parentId && (secId ? t.sectionId === secId : !t.sectionId)).sort((a, b) => a.position - b.position);
  const endOf = (secId) => (colTasks(secId).at(-1)?.position ?? 0) + 1;
  const sectionChoices = [...td.sections.map((x) => [x.id, x.name]), ['', S.unsectioned]];
  const card = (t, secId) => h('article', { class: 'bcard', draggable: canEdit ? 'true' : false,
    ondragstart: (e) => e.dataTransfer.setData('text/plain', t.id),
    ondragover: (e) => { if (canEdit) e.preventDefault(); },
    ondrop: (e) => { e.preventDefault(); e.stopPropagation(); const dragged = e.dataTransfer.getData('text/plain'); if (!canEdit || !dragged || dragged === t.id) return;
      const col = colTasks(secId), i = col.findIndex((x) => x.id === t.id), prev = col[i - 1]; move(dragged, secId, prev ? (prev.position + t.position) / 2 : t.position - 1); } },
    link(`#/p/${id}/board/t/${t.id}`, t.title, 'task-link'),
    h('div', { class: 'row-main' }, h('span', { class: `chip chip-${t.status}` }, S.status[t.status]), t.assigneeName && h('span', { class: 'muted' }, t.assigneeName),
      t.dueDate && h('span', { class: t.dueDate < today() && t.status !== 'done' ? 'overdue' : 'muted' }, t.dueDate < today() && t.status !== 'done' ? `${S.overdue}: ${t.dueDate}` : t.dueDate),
      t.isMilestone && h('span', { class: 'badge' }, S.milestone), sourceBits(t), subsOf(t).length > 0 && h('span', { class: 'muted' }, `${subsOf(t).filter((x) => x.status === 'done').length}/${subsOf(t).length}`)),
    canEdit && select(`mv-${t.id}`, `${S.moveTo}: ${t.title}`, sectionChoices, secId || '', (v) => move(t.id, v || null, endOf(v || null))));
  const column = (sec) => {
    const mine = colTasks(sec.id);
    if (!sec.id && !mine.length) return null;
    return h('section', { class: 'col', 'aria-label': sec.name, ondragover: (e) => { if (canEdit) e.preventDefault(); },
      ondrop: (e) => { e.preventDefault(); const dragged = e.dataTransfer.getData('text/plain'); if (canEdit && dragged) move(dragged, sec.id, endOf(sec.id)); } },
      h('h2', {}, `${sec.name} `, h('span', { class: 'muted' }, String(mine.length))), mine.length ? mine.map((t) => card(t, sec.id)) : h('p', { class: 'muted' }, S.noTasks));
  };
  const tabs = h('nav', { class: 'tabs', 'aria-label': S.views }, link(`#/p/${id}`, S.viewList, 'tab'), link(`#/p/${id}/board`, S.viewBoard, 'tab'));
  tabs.querySelectorAll('a')[view === 'board' ? 1 : 0].setAttribute('aria-current', 'page');
  const base = view === 'board' ? `#/p/${id}/board` : `#/p/${id}`;
  const body = [h('div', { class: 'page-head' }, h('h1', {}, proj.name), h('span', { class: 'badge' }, S.projectRoles[proj.myRole]), rank === 4 && link(`#/p/${id}/forms`, S.formsLink, 'btn btn-secondary'), rank === 4 && link(`#/p/${id}/settings`, S.settings, 'btn btn-secondary')),
    proj.archived && h('div', { class: 'banner', role: 'note' }, S.archivedBanner), tabs,
    ...(view === 'board' ? [canEdit && h('p', { class: 'muted' }, S.dragHint), h('div', { class: 'board' }, [...td.sections, { id: null, name: S.unsectioned }].map(column))]
      : [...td.sections, { id: null, name: S.unsectioned }].map(sectionBlock))];
  if (taskId) body.push(await drawer(ctx, id, taskId, { td, people, canEdit, rank, patch, reload, base }));
  return body;
}

async function drawer(ctx, projectId, taskId, k) {
  const r = await api('GET', `/api/v1/tasks/${taskId}`);
  if (r.status !== 200) return h('aside', { class: 'drawer', role: 'dialog', 'aria-label': S.notFound }, notFound());
  const d = r.data, t = d.task, { canEdit, rank, patch, reload } = k;
  document.title = pageTitle('S08', t.title);
  const close = () => { location.hash = k.base; };
  const text = (id, label, val, key, attrs = {}) => field(id, label, { value: val ?? '', disabled: !canEdit, ...attrs, onchange: (e) => patch(t.id, { [key]: attrs.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value.trim() || null) }, false) });
  const title = text('d-title', S.taskTitle, t.title, 'title', { maxlength: '300' });
  title.querySelector('input').onchange = (e) => patch(t.id, { title: e.target.value.trim() });
  const desc = h('div', { class: 'field' }, h('label', { for: 'd-desc' }, S.description), h('textarea', { id: 'd-desc', class: 'input', rows: '4', disabled: !canEdit, onchange: (e) => patch(t.id, { description: e.target.value }) }, t.description));
  const sub = h('input', { class: 'input', 'aria-label': S.addSubtask, placeholder: S.addSubtask, maxlength: '300' });
  const others = k.td.tasks.filter((x) => x.id !== t.id && !x.parentId).map((x) => [x.id, x.title]);
  let depId = '';
  const comment = h('textarea', { id: 'd-comment', class: 'input', rows: '3', 'aria-label': S.addComment, maxlength: '10000' });
  const del = h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (!confirm(S.confirmDeleteTask)) return; const x = await api('DELETE', `/api/v1/tasks/${t.id}`); if (x.status === 200) { close(); } else fail(x); } }, S.deleteTask);
  const node = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': t.title, },
    h('div', { class: 'page-head' }, h('h2', {}, S.status[t.status] + ': ' + t.title), h('button', { class: 'btn btn-secondary', type: 'button', onclick: close }, S.close)),
    title, desc,
    select('d-status', S.statusLabel, STATUS_OPTIONS, t.status, (v) => patch(t.id, { status: v }), !canEdit),
    select('d-assignee', S.assignee, k.people, t.assigneeId, (v) => patch(t.id, { assigneeId: v || null }), !canEdit),
    text('d-start', S.start, t.startDate, 'startDate', { type: 'date' }), text('d-due', S.due, t.dueDate, 'dueDate', { type: 'date' }),
    text('d-est', S.estimate, t.estimateMinutes, 'estimateMinutes', { type: 'number', min: '0' }),
    text('d-lane', S.lane, t.lane, 'lane', { maxlength: '80' }), text('d-promised', S.promised, t.promisedDate, 'promisedDate', { type: 'date' }),
    t.source === 'ingestion' && h('div', { class: 'row-main source-line' }, sourceBits(t)),
    h('div', { class: 'field check' }, h('input', { id: 'd-ms', type: 'checkbox', checked: t.isMilestone, disabled: !canEdit, onchange: (e) => patch(t.id, { isMilestone: e.target.checked }) }), h('label', { for: 'd-ms' }, S.milestone)),
    h('h3', {}, S.waitingOn), h('ul', { class: 'list' }, d.blockedBy.map((b) => h('li', { class: 'row' }, h('span', { class: 'row-main' }, `${b.title} (${S.status[b.status]})`),
      canEdit && h('button', { class: 'btn btn-secondary', type: 'button', 'aria-label': `${S.remove}: ${b.title}`, onclick: async () => { const x = await api('DELETE', `/api/v1/tasks/${t.id}/dependencies/${b.id}`); x.status === 200 ? reload() : fail(x); } }, S.remove)))),
    canEdit && h('div', { class: 'inline-form' }, select('d-dep', S.waitingOn, [['', S.chooseTask], ...others], '', (v) => { depId = v; }), h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { if (!depId) return; const x = await api('POST', `/api/v1/tasks/${t.id}/dependencies`, { dependsOnId: depId }); x.status === 201 ? reload() : fail(x); } }, S.addDependency)),
    !t.parentId && h('h3', {}, S.subtasks), !t.parentId && h('ul', { class: 'list' }, d.subtasks.map((s) => h('li', { class: 'row' }, link(`${k.base}/t/${s.id}`, s.title, 'task-link'), h('span', { class: `chip chip-${s.status}` }, S.status[s.status])))),
    !t.parentId && canEdit && h('form', { class: 'add-task', onsubmit: once(async () => { if (!sub.value.trim()) return; const x = await api('POST', `/api/v1/projects/${projectId}/tasks`, { title: sub.value.trim(), parentId: t.id, sectionId: t.sectionId }); x.status === 201 ? reload() : fail(x); }) }, sub, h('button', { class: 'btn btn-secondary', type: 'submit' }, S.addSubtask)),
    h('h3', {}, S.comments), d.comments.length ? h('ul', { class: 'list' }, d.comments.map((c) => h('li', { class: 'comment' }, h('strong', {}, c.author), h('span', { class: 'muted' }, ` ${c.createdAt.slice(0, 16).replace('T', ' ')} UTC`), h('p', {}, c.body)))) : h('p', { class: 'muted' }, S.noComments),
    rank >= 2 && h('form', { onsubmit: once(async () => { if (!comment.value.trim()) return; const x = await api('POST', `/api/v1/tasks/${t.id}/comments`, { body: comment.value }); x.status === 201 ? reload() : fail(x); }) }, h('div', { class: 'field' }, h('label', { for: 'd-comment' }, S.addComment), comment), h('button', { class: 'btn btn-primary', type: 'submit' }, S.addComment)),
    canEdit && del);
  if (lastDrawerTask !== taskId) { lastDrawerTask = taskId; queueMicrotask(() => node.querySelector('input')?.focus({ preventScroll: true })); }
  return node;
}

export async function settingsView(ctx, id) {
  const pr = await api('GET', `/api/v1/projects/${id}`);
  if (pr.status !== 200 || pr.data.myRole !== 'admin') return [notFound()];
  const p = pr.data;
  document.title = pageTitle('S09', p.name);
  const members = await api('GET', `/api/v1/projects/${id}/members`);
  const isWsAdmin = ['owner', 'admin'].includes(ctx.session.role);
  const all = isWsAdmin ? (await api('GET', '/api/v1/members')).data.members : [];
  const name = field('s-name', S.projectName, { value: p.name, maxlength: '120' });
  const vis = select('s-vis', S.visibility, Object.entries(S.vis).filter(([k]) => k !== 'team'), p.visibility);
  const save = async (body) => { const r = await api('PATCH', `/api/v1/projects/${id}`, body); r.status === 200 ? (toast(S.saved), ctx.refresh()) : fail(r); };
  const secName = field('s-sec', S.addSection, { maxlength: '120' });
  let addUser = '', addRole = 'editor';
  const roleOpts = Object.entries(S.projectRoles);
  return [h('div', { class: 'page-head' }, h('h1', {}, `${S.projectSettings}: ${p.name}`), link(`#/p/${id}`, S.myTasksMore, 'btn btn-secondary')),
    h('form', { class: 'card', onsubmit: once(async () => { await save({ name: name.querySelector('input').value.trim(), visibility: vis.querySelector('select').value }); }) }, name, vis, h('button', { class: 'btn btn-primary', type: 'submit' }, S.rename)),
    h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => save({ archived: !p.archived }) }, p.archived ? S.unarchive : S.archive),
    h('h2', {}, S.sections), h('ul', { class: 'list' }, pr.data.sections.map((s) => h('li', { class: 'row' }, h('span', { class: 'row-main' }, s.name),
      h('button', { class: 'btn btn-secondary', type: 'button', 'aria-label': `${S.remove}: ${s.name}`, onclick: async () => { const r = await api('DELETE', `/api/v1/sections/${s.id}`); r.status === 200 ? ctx.refresh() : fail(r); } }, S.remove)))),
    h('form', { class: 'inline-form', onsubmit: once(async () => { const v = secName.querySelector('input').value.trim(); if (!v) return; const r = await api('POST', `/api/v1/projects/${id}/sections`, { name: v }); r.status === 201 ? ctx.refresh() : fail(r); }) }, secName, h('button', { class: 'btn btn-secondary', type: 'submit' }, S.addSection)),
    h('h2', {}, S.projectPeople), h('ul', { class: 'list' }, members.data.members.map((m) => h('li', { class: 'row' }, h('span', { class: 'row-main' }, m.name),
      select(`pr-${m.userId}`, `${S.role}: ${m.name}`, roleOpts, m.role, async (v) => { const r = await api('PUT', `/api/v1/projects/${id}/members`, { userId: m.userId, role: v }); r.status === 200 ? toast(S.saved) : fail(r); ctx.refresh(); }),
      h('button', { class: 'btn btn-secondary', type: 'button', 'aria-label': `${S.remove}: ${m.name}`, onclick: async () => { const r = await api('DELETE', `/api/v1/projects/${id}/members/${m.userId}`); r.status === 200 ? ctx.refresh() : fail(r); } }, S.remove)))),
    isWsAdmin ? h('div', { class: 'inline-form' }, select('s-add', S.name, [['', S.chooseTask], ...all.filter((x) => !members.data.members.some((m) => m.userId === x.userId)).map((x) => [x.userId, x.name])], '', (v) => { addUser = v; }),
      select('s-addrole', S.role, roleOpts, 'editor', (v) => { addRole = v; }), h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { if (!addUser) return; const r = await api('PUT', `/api/v1/projects/${id}/members`, { userId: addUser, role: addRole }); r.status === 200 ? ctx.refresh() : fail(r); } }, S.addToProject))
      : h('p', { class: 'muted' }, S.onlyAdminsAdd)];
}

let reveal = null; // a one-time link, shown on the next People render and then forgotten
export async function peopleView(ctx) {
  document.title = pageTitle('S20');
  const { status, data } = await api('GET', '/api/v1/members');
  if (status !== 200) return [notFound()];
  
  const nameI = field('n-name', S.name, { maxlength: '100', required: true }), emailI = field('n-email', S.email, { type: 'email', required: true });
  const roleS = select('n-role', S.role, Object.entries(S.roles).filter(([k]) => k !== 'owner'), 'member');
  const out = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'card', onsubmit: once(async () => {
    const r = await api('POST', '/api/v1/members', { name: nameI.querySelector('input').value.trim(), email: emailI.querySelector('input').value.trim(), role: roleS.querySelector('select').value });
    if (r.status !== 201) return fail(r);
    // The password is shown here once and kept nowhere else.
    out.replaceChildren(h('div', { class: 'card reveal' }, h('h3', {}, `${S.tempPasswordTitle}: ${r.data.email}`), h('code', { class: 'secret' }, r.data.temporaryPassword), h('p', { class: 'muted' }, S.tempPasswordNote)));
    form.reset();
  }) }, h('h2', {}, S.addPerson), nameI, emailI, roleS, h('button', { class: 'btn btn-primary', type: 'submit' }, S.createPerson));
  const linkCard = (title, link, note, raw) => h('div', { class: 'card reveal' }, h('h3', {}, title), h('code', { class: 'secret' }, raw ?? `${location.origin}${link}`), h('p', { class: 'muted' }, note));
  if (reveal) { out.append(linkCard(reveal.title, reveal.link, reveal.note, reveal.raw)); reveal = null; }
  const act = (label, who, fn) => h('button', { class: 'btn btn-secondary', type: 'button', 'aria-label': `${label}: ${who}`, onclick: fn }, label);
  const rows = data.members.map((m) => h('li', { class: 'row' }, h('span', { class: 'row-main' }, `${m.name} `, h('span', { class: 'muted' }, m.email), m.status !== 'active' && h('span', { class: 'badge' }, S.deactivatedBadge)),
    select(`role-${m.userId}`, `${S.role}: ${m.name}`, Object.entries(S.roles), m.role, async (v) => { const r = await api('PATCH', `/api/v1/members/${m.userId}/role`, { role: v }); r.status === 200 ? toast(S.saved) : fail(r); ctx.refresh(); }),
    m.userId !== ctx.session.user.id && h('div', { class: 'actions' },
      m.status === 'active' && act(S.unlock, m.name, async () => { const r = await api('POST', `/api/v1/members/${m.userId}/unlock`); r.status === 200 ? toast(S.unlocked) : fail(r); }),
      m.status === 'active' && act(S.resetPassword, m.name, async () => { const r = await api('POST', `/api/v1/members/${m.userId}/reset`); if (r.status !== 201) return fail(r); reveal = { title: `${S.resetPassword}: ${r.data.email}`, link: r.data.link, note: S.linkNoteReset }; ctx.refresh(); }),
      m.status === 'active' && act(S.deactivatePerson, m.name, async () => { if (!confirm(S.confirmDeactivatePerson)) return; const r = await api('POST', `/api/v1/members/${m.userId}/deactivate`); r.status === 200 ? (toast(S.deactivatedDone), ctx.refresh()) : fail(r); }))));
  const inv = await api('GET', '/api/v1/invites');
  const iEmail = field('i-email', S.email, { type: 'email', required: true }), iRole = select('i-role', S.role, Object.entries(S.roles).filter(([k]) => k !== 'owner'), 'member');
  const inviteForm = h('form', { class: 'card', onsubmit: once(async () => {
    const r = await api('POST', '/api/v1/invites', { email: iEmail.querySelector('input').value.trim(), role: iRole.querySelector('select').value });
    if (r.status !== 201) return fail(r);
    reveal = { title: `${S.inviteHeading}: ${r.data.email}`, link: r.data.link, note: S.linkNoteInvite }; ctx.refresh();
  }) }, h('h2', {}, S.inviteHeading), iEmail, iRole, h('button', { class: 'btn btn-primary', type: 'submit' }, S.inviteButton));
  const pending = inv.data.invites.map((i) => h('li', { class: 'row' }, h('span', { class: 'row-main' }, `${i.email} `, h('span', { class: 'muted' }, `${S.roles[i.role]}, until ${i.expiresAt.slice(0, 10)}`)),
    act(S.revoke, i.email, async () => { const r = await api('DELETE', `/api/v1/invites/${i.id}`); r.status === 200 ? ctx.refresh() : fail(r); })));
  // ---- service accounts (other systems, such as Zen): admin-only, tokens shown once
  const sa = await api('GET', '/api/v1/service-accounts');
  const svcName = field('sa-name', S.svcName, { maxlength: '80' });
  const newSvc = h('form', { class: 'inline-form', onsubmit: once(async () => { const r = await api('POST', '/api/v1/service-accounts', { name: svcName.querySelector('input').value.trim() }); r.status === 201 ? ctx.refresh() : fail(r); }) }, svcName, h('button', { class: 'btn btn-secondary', type: 'submit' }, S.svcCreate));
  const accountBlock = (a) => {
    const label = field(`tl-${a.id}`, `${S.tokenLabel}: ${a.name}`, { maxlength: '80' });
    const boxes = [['tasks:write', S.scopeWrite], ['tasks:read', S.scopeRead]].map(([v, t]) => h('div', { class: 'field check' }, h('input', { id: `sc-${a.id}-${v}`, type: 'checkbox', value: v }), h('label', { for: `sc-${a.id}-${v}` }, t)));
    const tokenForm = h('form', { class: 'card', onsubmit: once(async () => {
      const scopes = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      const r = await api('POST', `/api/v1/service-accounts/${a.id}/tokens`, { label: label.querySelector('input').value.trim(), scopes });
      if (r.status !== 201) return fail(r);
      reveal = { title: `${S.tokenTitle}: ${a.name}`, raw: r.data.token, note: S.tokenNote }; ctx.refresh();
    }) }, label, h('fieldset', { class: 'plain' }, h('legend', {}, `${S.scopesLegend} (${a.name})`), ...boxes), h('button', { class: 'btn btn-secondary', type: 'submit' }, `${S.tokenCreate}: ${a.name}`));
    return h('li', { class: 'form-item' }, h('div', { class: 'page-head' }, h('h3', {}, a.name), a.status !== 'active' && h('span', { class: 'badge' }, S.closed)),
      a.tokens.length ? h('ul', { class: 'list' }, a.tokens.map((t) => h('li', { class: 'row' }, h('span', { class: 'row-main' }, `${t.label} `, h('span', { class: 'muted' }, `${t.scopes.join(', ')}; ${S.lastUsed} ${t.lastUsedAt ? t.lastUsedAt.slice(0, 16).replace('T', ' ') : S.never}${t.expiresAt ? `; ${S.expires} ${t.expiresAt.slice(0, 10)}` : ''}${t.revokedAt ? `; ${S.revoked}` : ''}`)),
        !t.revokedAt && act(S.revoke, t.label, async () => { const r = await api('DELETE', `/api/v1/service-accounts/${a.id}/tokens/${t.id}`); r.status === 200 ? ctx.refresh() : fail(r); })))) : h('p', { class: 'muted' }, S.noSvc),
      a.status === 'active' && tokenForm,
      a.status === 'active' && h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (!confirm(S.deactivate + '?')) return; const r = await api('DELETE', `/api/v1/service-accounts/${a.id}`); r.status === 200 ? ctx.refresh() : fail(r); } }, `${S.deactivate}: ${a.name}`));
  };
  return [h('h1', {}, S.peopleHeading), h('ul', { class: 'list' }, rows), form, inviteForm, h('h2', {}, S.pendingInvites), pending.length ? h('ul', { class: 'list' }, pending) : h('p', { class: 'muted' }, S.noInvites),
    h('h2', {}, S.svcHeading), h('p', { class: 'muted' }, S.svcIntro), sa.data.accounts.length ? h('ul', { class: 'list' }, sa.data.accounts.map(accountBlock)) : h('p', { class: 'muted' }, S.noSvc), newSvc, out];
}

export async function accountView(ctx) {
  document.title = pageTitle('S36');
  const cur = field('a-cur', S.currentPassword, { type: 'password', autocomplete: 'current-password' }), next = field('a-new', S.newPassword, { type: 'password', autocomplete: 'new-password' });
  const form = h('form', { class: 'card auth', onsubmit: once(async () => {
    const r = await api('POST', '/api/v1/auth/password', { current: cur.querySelector('input').value, next: next.querySelector('input').value });
    if (r.status !== 200) return fail(r);
    toast(S.passwordChanged); form.reset();
    if (ctx.session.mustChangePassword) { await ctx.restart(); location.hash = '#/'; }   // the forced change is done: load the real session
  }) }, cur, next, h('button', { class: 'btn btn-primary', type: 'submit' }, S.changePassword));
  return [h('h1', {}, S.accountHeading), ctx.session.mustChangePassword && h('div', { class: 'banner', role: 'note' }, S.mustChangeBanner), form];
}

// Width is set through the CSS object model: allowed under our Content-Security-Policy, unlike a style attribute.
function meterFill(pct) { const el = h('div', { class: 'meter-fill' }); el.style.width = `${pct}%`; return el; }

// ---- dashboard: fixed widgets, hand-drawn SVG, a numbers table behind every chart
function barChart(title, rows, colorClass) {
  const max = Math.max(1, ...rows.map((r) => r.value)), rowH = 30, labelW = 150, barW = 170, w = labelW + barW + 40;
  const chart = svg('svg', { viewBox: `0 0 ${w} ${rows.length * rowH + 4}`, role: 'img', 'aria-label': title, class: 'chart' },
    svg('title', {}, title),
    rows.map((r, i) => svg('g', { transform: `translate(0 ${i * rowH + 2})` },
      svg('text', { x: 0, y: 17, class: 'chart-label' }, r.label.length > 22 ? `${r.label.slice(0, 21)}...` : r.label),
      svg('rect', { x: labelW, y: 3, width: Math.max(r.value ? 4 : 0, (r.value / max) * barW), height: 18, rx: 4, class: colorClass }),
      svg('text', { x: labelW + (r.value / max) * barW + 6, y: 17, class: 'chart-value' }, String(r.value)))));
  const table = h('table', { class: 'data-table' }, h('caption', {}, title), h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.label), h('td', {}, String(r.value))))));
  return h('section', { class: 'card widget' }, h('h2', {}, title), chart, h('details', {}, h('summary', {}, S.showData), table));
}

export async function reportsView(ctx) {
  document.title = pageTitle('S14');
  const { data } = await api('GET', '/api/v1/reports/summary');
  const total = Object.values(data.byStatus).reduce((a, b) => a + b, 0);
  const tile = (label, value) => h('div', { class: 'tile' }, h('p', { class: 'tile-value' }, String(value)), h('p', { class: 'tile-label' }, label));
  if (!total) return [h('h1', {}, S.dashHeading), h('div', { class: 'empty' }, h('p', {}, S.dashEmpty))];
  return [h('h1', {}, S.dashHeading),
    h('div', { class: 'tiles' }, tile(S.dashOpen, data.totals.open), tile(S.dashOverdue, data.totals.overdue), tile(S.dashSoon, data.totals.dueSoon), tile(S.dashDone, data.totals.doneRecently)),
    h('div', { class: 'widgets' },
      barChart(S.dashByStatus, Object.entries(S.status).map(([k, label]) => ({ label, value: data.byStatus[k] })), 'bar-1'),
      barChart(S.dashByPerson, data.byAssignee.map((r) => ({ label: r.name || S.unassigned, value: r.open })), 'bar-2')),
    h('section', { class: 'card widget' }, h('h2', {}, S.dashByProject),
      h('ul', { class: 'list' }, data.byProject.map((p) => h('li', { class: 'row prog' }, h('span', { class: 'row-main' }, link(`#/p/${p.id}`, p.name, 'task-link'), h('span', { class: 'muted' }, ` ${p.done} of ${p.total} done`)),
        h('div', { class: 'meter', role: 'progressbar', 'aria-label': `${p.name}: ${p.done} of ${p.total} done`, 'aria-valuemin': '0', 'aria-valuemax': String(p.total), 'aria-valuenow': String(p.done) },
          meterFill(p.total ? Math.round((100 * p.done) / p.total) : 0)))))),
    h('p', { class: 'muted' }, S.dashNote)];
}
