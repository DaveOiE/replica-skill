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
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { error: S.networkError } };
  }
}
