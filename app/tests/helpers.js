import { openDb, migrate } from '../server/db.js';
import { seedDemo } from '../seed/seed.js';

/** Fresh in-memory database with the schema and the fake demo workspace. */
export function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, creds: seedDemo(db) };
}

import { buildApp } from '../server/app.js';

/** App + database + fake users, with signIn(key) returning a Cookie header for a seeded user. */
export async function freshApp(opts = {}) {
  // creds keys: owner admin member member2 viewonly guest outsider, plus workspaces, projects, sections, tasks
  const { db, creds } = freshDb();
  const app = await buildApp({ db, ...opts });
  const cookies = {};
  const signIn = async (key) => {
    if (cookies[key]) return cookies[key];
    const c = creds[key];
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: c.email, password: c.password } });
    if (r.statusCode !== 200) throw new Error(`sign-in for ${key} failed: ${r.statusCode} ${r.body}`);
    cookies[key] = r.cookies.map((k) => `${k.name}=${k.value}`).join('; ');
    return cookies[key];
  };
  const call = async (key, method, url, payload) =>
    app.inject({ method, url, payload, headers: key ? { cookie: await signIn(key) } : {} });
  return { app, db, creds, signIn, call };
}
