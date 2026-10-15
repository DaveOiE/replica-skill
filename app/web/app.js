import { h, field } from './dom.js';
import { api } from './api.js';
import { S } from './strings.js';
import { pageTitle } from '/shared/titles.js';
import { inviteView, resetView } from './views-public.js';
import { jobsView, importView } from './views-jobs.js';
import { auditView } from './views-audit.js';
import { formsAdminView, publicFormView } from './views-forms.js';
import { myTasksView, projectsView, reportsView, projectView, settingsView, peopleView, accountView } from './views.js';

const root = document.getElementById('app');
let session = null;

function setTitle(screenId) { document.title = pageTitle(screenId); }


function signInView(prefillWorkspace = false, notice = null) {
  setTitle('S01');
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const button = h('button', { class: 'btn btn-primary', type: 'submit' }, S.signInButton);
  const form = h('form', { class: 'card auth', novalidate: true },
    h('h1', {}, S.signInHeading),
    notice && h('p', { class: 'banner banner-info', role: 'status' }, notice),
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
  const signOut = h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { await api('POST', '/api/v1/auth/signout'); session = null; location.hash = '#/'; await start(); } }, S.signOut);
  const here = location.hash || '#/';
  const item = (href, text, on) => h('a', { href, 'aria-current': on ? 'page' : false }, text);
  const admin = ['owner', 'admin'].includes(session.role);
  return h('div', { class: 'shell' },
    h('a', { class: 'skip', href: '#main' }, S.skipToContent),
    h('header', { class: 'topbar' }, h('strong', { class: 'workspace-name' }, session.workspace.name), h('span', { class: 'badge' }, roleLabel), h('span', { class: 'who' }, session.user.name), signOut),
    h('nav', { class: 'side', 'aria-label': S.navLabel },
      item('#/', S.nav.myTasks, here === '#/'), item('#/projects', S.nav.projects, here.startsWith('#/projects') || here.startsWith('#/p/')), item('#/jobs', S.nav2.jobs, here === '#/jobs' || here === '#/import'), item('#/reports', S.nav.dashboard, here === '#/reports'),
      admin && item('#/people', S.nav.people, here === '#/people'), admin && item('#/audit', S.nav.audit, here === '#/audit'), item('#/account', S.nav.account, here === '#/account')),
    h('main', { id: 'main', class: 'content', tabindex: '-1' },
      /\(demo\)$/.test(session.workspace.name) && banner(S.demoBanner), session.role === 'view_only' && banner(S.viewOnlyBanner, 'banner-info'), content),
    h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' }));
}

async function route() {
  const ctx = { session, refresh: route };
  const hash = location.hash || '#/';
  let parts;
  if (hash === '#/') parts = await myTasksView(ctx);
  else if (hash === '#/projects') parts = await projectsView(ctx);
  else if (hash === '#/jobs') parts = await jobsView(ctx);
  else if (hash === '#/import') parts = await importView(ctx);
  else if (hash === '#/reports') parts = await reportsView(ctx);
  else if (hash === '#/people') parts = await peopleView(ctx);
  else if (hash === '#/audit') parts = await auditView(ctx);
  else if (hash === '#/account') parts = await accountView(ctx);
  else if ((parts = hash.match(/^#\/p\/([\w-]+)\/forms$/))) parts = await formsAdminView(ctx, parts[1]);
  else if ((parts = hash.match(/^#\/p\/([\w-]+)\/settings$/))) parts = await settingsView(ctx, parts[1]);
  else if ((parts = hash.match(/^#\/p\/([\w-]+)(\/board)?(?:\/t\/([\w-]+))?$/))) parts = await projectView(ctx, parts[1], parts[3], parts[2] ? 'board' : 'list');
  else parts = [h('div', { class: 'empty' }, h('p', {}, S.notFound))];
  const scroll = window.scrollY;
  render(shell(parts), false);
  window.scrollTo(0, scroll);
}

function render(node, focus = true) { root.replaceChildren(node); if (focus) { const f = root.querySelector('input,[tabindex="-1"]'); if (f) f.focus({ preventScroll: true }); } }

export async function start(notice = null) {
  const pub = location.hash.match(/^#\/(invite|reset|f)\/([\w-]+)$/);
  if (pub) { session = null; if (pub[1] === 'f') return render(await publicFormView(pub[2])); return render(pub[1] === 'invite' ? await inviteView(pub[2], () => start()) : await resetView(pub[2], (n) => start(n))); }
  const { status, data } = await api('GET', '/api/v1/auth/session');
  session = status === 200 ? data : null;
  if (!session) return render(signInView(false, notice));
  await route();
}

// Escape closes an open task, wherever keyboard focus happens to be.
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const m = location.hash.match(/^(#\/p\/[\w-]+(?:\/board)?)\/t\//); if (m) location.hash = m[1]; });

window.addEventListener('session-ended', () => { if (!session) return; session = null; location.hash = '#/'; render(signInView(false, S.signedOut)); });

window.addEventListener('hashchange', () => { if (/^#\/(invite|reset|f)\//.test(location.hash)) start(); else if (session) route(); });
start();
