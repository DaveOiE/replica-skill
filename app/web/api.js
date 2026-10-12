import { S } from './strings.js';

/** JSON call to the API. Returns { status, data }. Network failure becomes status 0 with a plain message. */
export async function api(method, url, body) {
  try {
    const res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    // A 401 anywhere except sign-in and the first session check means the session ended: tell the app.
    if (res.status === 401 && !url.includes('/auth/signin') && !url.includes('/auth/session')) window.dispatchEvent(new CustomEvent('session-ended'));
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: S.networkError } };
  }
}
