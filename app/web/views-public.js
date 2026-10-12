// Pages a person reaches from a link, before they have an account or while signed out.
import { h, field, once } from './dom.js';
import { api } from './api.js';
import { S } from './strings.js';
import { pageTitle } from '/shared/titles.js';

const card = (...kids) => h('main', { class: 'center' }, h('div', { class: 'card auth' }, ...kids));
const invalid = () => card(h('h1', {}, S.signInHeading), h('p', { class: 'form-error', role: 'alert' }, S.invalidLink), h('a', { href: '#/', class: 'btn btn-secondary' }, S.toSignIn));

function passwordForm({ heading, intro, extra, button, submit }) {
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const pw = field('p-new', S.newPassword, { type: 'password', autocomplete: 'new-password', required: true });
  const form = h('form', { class: 'card auth', novalidate: true, onsubmit: once(async () => {
    const res = await submit(form);
    if (!res.ok) { error.hidden = false; error.textContent = res.error; }
  }) }, h('h1', {}, heading), intro, extra, pw, h('p', { class: 'hint' }, S.passwordHint), error, h('button', { class: 'btn btn-primary', type: 'submit' }, button));
  return h('main', { class: 'center' }, form);
}

export async function inviteView(token, done) {
  document.title = pageTitle('S02');
  const { status, data } = await api('GET', `/api/v1/invites/${token}`);
  if (status !== 200) return invalid();
  return passwordForm({ heading: `${S.joinHeading} ${data.workspaceName}`, intro: h('p', { class: 'muted' }, data.email),
    extra: field('p-name', S.yourName, { autocomplete: 'name', required: true, maxlength: '100' }), button: S.setPassword,
    submit: async (form) => {
      const password = form.elements['p-new'].value;
      const r = await api('POST', `/api/v1/invites/${token}/accept`, { name: form.elements['p-name'].value.trim(), password });
      if (r.status !== 201) return { ok: false, error: r.data?.error || S.networkError };
      const s = await api('POST', '/api/v1/auth/signin', { email: data.email, password });
      if (s.status === 200) { location.hash = '#/'; await done(); return { ok: true }; }
      return { ok: false, error: s.data?.error || S.networkError };
    } });
}

export async function resetView(token, done) {
  document.title = pageTitle('S37');
  const { status, data } = await api('GET', `/api/v1/resets/${token}`);
  if (status !== 200) return invalid();
  return passwordForm({ heading: S.resetHeading, intro: h('p', { class: 'muted' }, `${data.email} · ${data.workspaceName}`), button: S.setPassword,
    submit: async (form) => {
      const r = await api('POST', `/api/v1/resets/${token}/complete`, { password: form.elements['p-new'].value });
      if (r.status !== 200) return { ok: false, error: r.data?.error || S.networkError };
      location.hash = '#/'; await done(S.resetDone); return { ok: true };
    } });
}
