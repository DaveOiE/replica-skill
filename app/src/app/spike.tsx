'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openLocal, seedDemo, type Local } from '../client/localdb';
import { checkout, stockLevels, recentOrders, stockExceptions, addProduct } from '../domain/store';
import { connectServer, getSyncStatus, syncOnce, type SyncStatus } from '../sync/client';
import { createVerifiedBackup } from '../backup/backup';

type Row = Awaited<ReturnType<typeof stockLevels>>[number];
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function Spike() {
  const local = useRef<Local | null>(null);
  const [ready, setReady] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [orders, setOrders] = useState<{ number: string; total_cents: number }[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [online, setOnline] = useState(true);
  const [msg, setMsg] = useState('');
  const [exceptions, setExceptions] = useState<string[]>([]);
  const [url, setUrl] = useState('http://127.0.0.1:4100');
  const [token, setToken] = useState('e2e-token');
  const [pass, setPass] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const syncing = useRef(false);

  const refresh = useCallback(async () => {
    const l = local.current; if (!l) return;
    setRows(await stockLevels(l.db));
    setOrders(await recentOrders(l.db, 10));
    setStatus(await getSyncStatus(l.db, navigator.onLine));
    setExceptions((await stockExceptions(l.db)).map((r) => r.sku));
  }, []);

  const doSync = useCallback(async () => {
    const l = local.current; if (!l || syncing.current) return;
    if (!(await getSyncStatus(l.db)).lastSyncAt && (await getSyncStatus(l.db)).mode === 'standalone') return;
    syncing.current = true;
    try { await syncOnce(l.db); } catch { /* recorded in meta, shown in status */ } finally { syncing.current = false; await refresh(); }
  }, [refresh]);

  useEffect(() => {
    (async () => {
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
      try { local.current = await openLocal(); } catch (e) { if ((e as Error).message === 'OPEN_ELSEWHERE') { setElsewhere(true); return; } throw e; }
      (window as any).__tb = { db: local.current.db, addProduct, checkout, stockLevels }; // test probes only
      setOnline(navigator.onLine);
      setReady(true);
      await refresh();
    })();
    const on = () => { setOnline(true); void doSync(); }, off = () => { setOnline(false); void refresh(); };
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const t = setInterval(() => { if (navigator.onLine) void doSync(); }, 5000);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t); };
  }, [refresh, doSync]);

  if (elsewhere) return <p data-testid="open-elsewhere">Tillbox is already open in another window on this device. Close it, or use that window.</p>;
  if (!ready || !local.current) return <p>Opening local database…</p>;
  const l = local.current;
  const total = rows.reduce((s, r) => s + (cart[r.id] ?? 0) * r.price_cents, 0);

  const pay = async () => {
    try {
      const items = Object.entries(cart).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty }));
      const o = await checkout(l.db, items, total);
      setCart({}); setMsg(`Order ${o.number} ${money(o.totalCents)}`);
    } catch (e) { setMsg(`Error: ${(e as Error).message}`); }
    await refresh();
  };
  const connect = async () => { await connectServer(l.db, { url, token }); await doSync(); };
  const backup = async () => {
    setBackupMsg('working…');
    try { const { bytes, check } = await createVerifiedBackup(l.pg, pass || 'spike'); setBackupMsg(`verified backup ${bytes.length} bytes, ${check.counts.orders} orders`); }
    catch (e) { setBackupMsg(`failed: ${(e as Error).message}`); }
  };

  const label = !status ? '' : status.state === 'pending' ? `pending (${status.pending})` : status.state === 'error' ? `error: ${status.lastError}` : status.state;
  return (
    <main>
      <h1>Tillbox spike</h1>
      <p>Device <b data-testid="prefix">{l.info.prefix}</b> · sync: <b data-testid="status">{label}</b> · network: <span data-testid="net">{online ? 'online' : 'offline'}</span> · persistent storage: <span data-testid="persisted">{String(l.persisted)}</span></p>
      {rows.length === 0 && <p><button data-testid="seed-demo" onClick={async () => { await seedDemo(l.db); await refresh(); }}>Start a new store with demo products</button> or connect to a server below to join an existing one.</p>}
      <table><tbody>
        {rows.map((r) => (
          <tr key={r.id} data-testid={`product-${r.sku}`}>
            <td>{r.name}</td><td>{money(r.price_cents)}</td>
            <td>stock <b data-testid={`stock-${r.sku}`}>{r.stock}</b></td>
            <td><button data-testid={`add-${r.sku}`} onClick={() => setCart((c) => ({ ...c, [r.id]: (c[r.id] ?? 0) + 1 }))}>Add</button></td>
          </tr>))}
      </tbody></table>
      <p>Cart qty <b data-testid="cart-qty">{Object.values(cart).reduce((s, q) => s + q, 0)}</b> total <b data-testid="cart-total">{money(total)}</b> <button data-testid="pay" disabled={total === 0} onClick={pay}>Pay cash (exact)</button></p>
      <p data-testid="last-order">{msg}</p>
      <p>Oversold: <span data-testid="exceptions">{exceptions.join(',') || 'none'}</span></p>
      <h3>Orders (<span data-testid="orders-count">{orders.length}</span> shown)</h3>
      <ul data-testid="orders">{orders.map((o) => <li key={o.number}>{o.number} {money(o.total_cents)}</li>)}</ul>
      <h3>Server</h3>
      <input data-testid="server-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input data-testid="server-token" value={token} onChange={(e) => setToken(e.target.value)} />
      <button data-testid="connect" onClick={connect}>Connect &amp; sync</button>
      <button data-testid="sync-now" onClick={() => void doSync()}>Sync now</button>
      <h3>Backup</h3>
      <input data-testid="backup-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="passphrase" />
      <button data-testid="backup" onClick={backup}>Create verified backup</button> <span data-testid="backup-result">{backupMsg}</span>
    </main>
  );
}
