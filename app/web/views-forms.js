// Request forms: the builder for project admins, and the public page anyone can fill in.
import { h, field, select, toast, once } from './dom.js';
import { api } from './api.js';
import { S } from './strings.js';
import { pageTitle } from '/shared/titles.js';

const fail = (res) => toast(res.data?.error || S.networkError, true);

export async function formsAdminView(ctx, id) {
  const pr = await api('GET', `/api/v1/projects/${id}`);
  if (pr.status !== 200 || pr.data.myRole !== 'admin') return [h('div', { class: 'empty' }, h('p', {}, S.notFound))];
  document.title = pageTitle('S10', pr.data.name);
  const [{ data: fl }, { data: pp }] = await Promise.all([api('GET', `/api/v1/projects/${id}/forms`), api('GET', `/api/v1/projects/${id}/people`)]);
  const people = [['', S.noOne], ...pp.people.map((x) => [x.userId, x.name])];
  const sections = pr.data.sections.map((x) => [x.id, x.name]);
  const link = (f) => `${location.origin}/#/f/${f.slug}`;
  const list = fl.forms.map((f) => h('li', { class: 'form-item' },
    h('div', { class: 'page-head' }, h('h3', {}, f.name), h('span', { class: 'badge' }, f.isOpen ? S.open : S.closed), h('span', { class: 'muted' }, `${f.submissions} ${S.requestsReceived}`)),
    h('p', { class: 'muted' }, S.publicLink), h('code', { class: 'secret' }, link(f)),
    f.lastRuleError && h('p', { class: 'form-error', role: 'alert' }, `${S.ruleProblem} ${f.lastRuleError}`),
    select(`fa-${f.id}`, `${S.formAssign}: ${f.name}`, people, f.assigneeId, async (v) => { const r = await api('PATCH', `/api/v1/forms/${f.id}`, { assigneeId: v || null }); r.status === 200 ? toast(S.saved) : fail(r); ctx.refresh(); }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { const r = await api('PATCH', `/api/v1/forms/${f.id}`, { isOpen: !f.isOpen }); r.status === 200 ? ctx.refresh() : fail(r); } }, `${f.isOpen ? S.closeForm : S.openForm}: ${f.name}`),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (!confirm(S.confirmDeleteForm)) return; const r = await api('DELETE', `/api/v1/forms/${f.id}`); r.status === 200 ? ctx.refresh() : fail(r); } }, `${S.deleteForm}: ${f.name}`))));

  // builder: one editable row per question
  let qs = [{ label: 'What do you need help with?', kind: 'text', required: true, options: '', title: true }, { label: 'Tell us more', kind: 'long_text', required: false, options: '', title: false }];
  const rowsBox = h('div', {});
  const drawRows = () => rowsBox.replaceChildren(...qs.map((q, i) => h('fieldset', { class: 'card qrow' }, h('legend', {}, `${S.qLabel} ${i + 1}`),
    field(`q-label-${i}`, S.qLabel, { value: q.label, maxlength: '200', onchange: (e) => { q.label = e.target.value; } }),
    select(`q-kind-${i}`, S.qKind, Object.entries(S.kinds), q.kind, (v) => { q.kind = v; drawRows(); }),
    q.kind === 'single_select' && field(`q-opts-${i}`, S.qChoices, { value: q.options, onchange: (e) => { q.options = e.target.value; } }),
    h('div', { class: 'field check' }, h('input', { id: `q-req-${i}`, type: 'checkbox', checked: q.required, onchange: (e) => { q.required = e.target.checked; } }), h('label', { for: `q-req-${i}` }, S.qRequired)),
    h('div', { class: 'field check' }, h('input', { id: `q-title-${i}`, type: 'radio', name: 'q-title', checked: q.title, onchange: () => { qs.forEach((x) => { x.title = false; }); q.title = true; } }), h('label', { for: `q-title-${i}` }, S.qTitle)),
    qs.length > 1 && h('button', { class: 'btn btn-secondary', type: 'button', 'aria-label': `${S.removeQuestion} ${i + 1}`, onclick: () => { qs.splice(i, 1); drawRows(); } }, S.removeQuestion))));
  drawRows();
  const name = field('f-name', S.formName, { value: 'IT support request', maxlength: '120' });
  const sec = select('f-section', S.formSection, sections, sections[0]?.[0]);
  const who = select('f-assign', S.formAssign, people, '');
  const builder = h('form', { class: 'card', onsubmit: once(async () => {
    const body = { name: name.querySelector('input').value.trim(), targetSectionId: sec.querySelector('select').value, assigneeId: who.querySelector('select').value || null,
      questions: qs.map((q) => ({ label: q.label.trim(), kind: q.kind, required: q.required, ...(q.kind === 'single_select' ? { options: q.options.split(',').map((x) => x.trim()).filter(Boolean) } : {}), ...(q.title ? { mapsTo: 'title' } : {}) })) };
    const r = await api('POST', `/api/v1/projects/${id}/forms`, body);
    r.status === 201 ? (toast(S.saved), ctx.refresh()) : fail(r);
  }) }, h('h2', {}, S.newForm), name, sec, who, rowsBox, h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { qs.push({ label: '', kind: 'text', required: false, options: '', title: false }); drawRows(); } }, S.addQuestion), h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, S.createForm)));
  return [h('div', { class: 'page-head' }, h('h1', {}, `${S.formsHeading}: ${pr.data.name}`), h('a', { href: `#/p/${id}`, class: 'btn btn-secondary' }, S.myTasksMore)),
    list.length ? h('ul', { class: 'list' }, list) : h('div', { class: 'empty' }, h('p', {}, S.noForms)), builder];
}

/** The page behind a public link. It shows the form's name and questions and nothing else from inside the workspace. */
export async function publicFormView(slug) {
  document.title = pageTitle('S11');
  const { status, data } = await api('GET', `/api/v1/public/forms/${slug}`);
  const card = (...kids) => h('main', { class: 'center' }, h('div', { class: 'card auth wide' }, ...kids));
  if (status !== 200) return card(h('h1', {}, S.formNotAvailable));
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const inputs = data.questions.map((q) => {
    const id = `pq-${q.id}`, label = `${q.label}${q.required ? '' : ''}`;
    const el = q.kind === 'long_text' ? h('textarea', { id, class: 'input', rows: '4', maxlength: '5000', required: q.required }) : q.kind === 'single_select'
      ? h('select', { id, class: 'input', required: q.required }, h('option', { value: '' }, ''), q.options.map((o) => h('option', { value: o }, o))) : h('input', { id, class: 'input', maxlength: '300', required: q.required });
    return { q, el, node: h('div', { class: 'field' }, h('label', { for: id }, q.required ? `${label} (${S.requiredMark})` : label), el) };
  });
  const email = field('pq-email', S.yourEmail, { type: 'email', autocomplete: 'email', maxlength: '254' });
  const trap = h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { for: 'pq-website' }, 'Website'), h('input', { id: 'pq-website', name: 'website', tabindex: '-1', autocomplete: 'off' })); // humans never see this box
  const form = h('form', { class: 'card auth wide', novalidate: true, onsubmit: once(async () => {
    const answers = Object.fromEntries(inputs.map(({ q, el }) => [q.id, el.value]).filter(([, v]) => v.trim()));
    const r = await api('POST', `/api/v1/public/forms/${slug}/submit`, { answers, email: email.querySelector('input').value.trim(), website: trap.querySelector('input').value });
    if (r.status === 200) return form.replaceChildren(h('h1', {}, S.thanks));
    error.hidden = false; error.textContent = r.data?.error || S.networkError;
  }) }, h('h1', {}, data.name), ...inputs.map((i) => i.node), email, trap, error, h('button', { class: 'btn btn-primary', type: 'submit' }, S.sendRequest));
  return h('main', { class: 'center' }, form);
}
