// Offline app shell. Install pre-caches every file listed in precache.json (written at build time); afterwards the
// cache answers first and refreshes quietly when online. Data never passes through here: it lives in the database.
const CACHE = 'tillbox-shell-v2';
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const list = await (await fetch('/precache.json', { cache: 'no-store' })).json();
    const c = await caches.open(CACHE);
    await Promise.all(list.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;   // sync traffic goes straight to the network
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('offline', { status: 503 });
  })());
});
