import { h } from './dom.js';
import { api } from './api.js';
import { S } from './strings.js';
import { pageTitle } from '/shared/titles.js';

const root = document.getElementById('app');
let session = null;

function setTitle(screenId) { document.title = pageTitle(screenId); }

function field(id, label, attrs = {}) {
  return h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, name: id, class: 'input', ...attrs }));
}

function signInView(prefillWorkspace = false) {
  setTitle('S01');
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const button = h('button', { class: 'btn btn-primary', type: 'submit' }, S.signInButton);
  const form = h('form', { class: 'card auth', novalidate: true },
    h('h1', {}, S.signInHeading),
    field('email', S.email, { type: 'email', autocomplete: 'username', required: true }),
    field('password', S.password, { type: 'password', autocomplete: 'current-password', required: true }),
    prefillWorkspace && h('div', { class: 'field' }, h('p', { class: 'hint' }, `${S.workspaceHint} demo`),
      h('label', { for: 'workspace' }, S.workspace), h('input', { id: 'workspace', name: 'workspace', class: 'input', autocomplete: 'organization' })),
    error, button);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (n) => form.elements[n]?.value.trim();
    button.disabled = true; button.textContent = S.signingIn;
    const { status, data } = await api('POST', '/api/v1/auth/signin', { email: v('email'), password: form.elements.password.value, ...(v('workspace') ? { workspace: v('workspace') } : {}) });
    if (status === 200) { await start(); return; }
    button.disabled = false; button.textContent = S.signInButton;
    if (status === 409) { render(signInView(true)); return; }
    error.hidden = false; error.textContent = data?.error || S.networkError;
  });
  return h('main', { class: 'center' }, form);
}

function banner(text, cls) { return h('div', { class: `banner ${cls || ''}`, role: 'note' }, text); }

function shell(content) {
  const roleLabel = S.roles[session.role] || session.role;
  const signOut = h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { await api('POST', '/api/v1/auth/signout'); session = null; location.hash = '#/signin'; await start(); } }, S.signOut);
  return h('div', { class: 'shell' },
    h('a', { class: 'skip', href: '#main' }, S.skipToContent),
    h('header', { class: 'topbar' },
      h('strong', { class: 'workspace-name' }, session.workspace.name),
      h('span', { class: 'badge' }, roleLabel),
      h('span', { class: 'who' }, session.user.name), signOut),
    h('nav', { class: 'side', 'aria-label': S.navLabel }, h('a', { href: '#/', 'aria-current': 'page' }, S.myTasksHeading)),
    h('main', { id: 'main', class: 'content', tabindex: '-1' },
      /\(demo\)$/.test(session.workspace.name) && banner(S.demoBanner),
      session.role === 'view_only' && banner(S.viewOnlyBanner, 'banner-info'),
      content));
}

function myTasksView() {
  setTitle('S03');
  return shell([h('h1', {}, S.myTasksHeading), h('div', { class: 'empty' }, h('p', {}, S.myTasksEmpty))]);
}

function render(node) { root.replaceChildren(node); const f = root.querySelector('input,[tabindex="-1"]'); if (f) f.focus({ preventScroll: true }); }

export async function start() {
  const { status, data } = await api('GET', '/api/v1/auth/session');
  session = status === 200 ? data : null;
  render(session ? myTasksView() : signInView());
}

window.addEventListener('hashchange', () => { if (session) render(myTasksView()); });
start();
