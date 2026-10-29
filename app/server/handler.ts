import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../src/db/types';
import { applyChanges, type Change } from '../src/sync/apply';
import { getMeta, setMeta } from '../src/domain/store';
import { migrateServer } from '../src/db/migrate';
import { SCHEMA_VERSION } from '../src/schema/migrations.generated';
import { reconcileDuplicateSkus } from '../src/sync/reconcile';

export interface Reply { status: number; body: unknown }
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export async function initServerDb(db: Db) {
  await migrateServer(db);
  if (!(await getMeta(db, 'device_id'))) await setMeta(db, 'device_id', crypto.randomUUID());   // the server's own writer id
  if (!(await getMeta(db, 'store_id'))) await setMeta(db, 'store_id', crypto.randomUUID());     // which shop this server holds
}

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function createHandlers(db: Db, opts: { adminToken: string; now?: () => Date }) {
  const now = opts.now ?? (() => new Date());
  const attempts: number[] = []; // recent failed pairing attempts, to slow guessing

  const isAdmin = (auth?: string | null) => !!auth && safeEq(auth, `Bearer ${opts.adminToken}`);

  /** Resolve a device bearer token to its device id (or null if unknown or revoked). */
  async function deviceFor(auth?: string | null): Promise<string | null> {
    if (!auth?.startsWith('Bearer ')) return null;
    const [row] = await db.query<{ device_id: string }>('SELECT device_id FROM device_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [sha(auth.slice(7))]);
    return row?.device_id ?? null;
  }

  async function info(): Promise<Reply> {
    const [{ n }] = await db.query<{ n: number }>('SELECT (SELECT count(*) FROM orders) + (SELECT count(*) FROM products) AS n');
    return { status: 200, body: { storeId: await getMeta(db, 'store_id'), schemaVersion: SCHEMA_VERSION, hasData: Number(n) > 0 } };
  }

  async function createPairingCode(label: string | undefined, ttlMinutes = 15): Promise<Reply> {
    const raw = Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    await db.query('INSERT INTO pairing_codes (code_hash, label, expires_at) VALUES ($1, $2, $3)', [sha(code), label ?? null, new Date(now().getTime() + ttlMinutes * 60_000)]);
    return { status: 200, body: { code, expiresInMinutes: ttlMinutes } };
  }

  async function revokeDevice(deviceId: string): Promise<Reply> {
    await db.query('UPDATE device_tokens SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [deviceId]);
    return { status: 200, body: { ok: true } };
  }

  /** A device presents a single-use pairing code and receives its own token. The code is only spent on success. */
  async function pair(b: { code: string; deviceId: string; name: string; orderPrefix: string; schemaVersion: string }): Promise<Reply> {
    const cutoff = now().getTime() - 60_000;
    while (attempts.length && attempts[0] < cutoff) attempts.shift();
    if (attempts.length >= 20) return { status: 429, body: { error: 'too_many_attempts' } };
    if (b.schemaVersion !== SCHEMA_VERSION) return { status: 426, body: { error: 'schema_mismatch', server: SCHEMA_VERSION, client: b.schemaVersion } };
    const result = await db.transaction(async (tx): Promise<Reply> => {
      await tx.query('SELECT pg_advisory_xact_lock(7001)');
      const [code] = await tx.query<{ code_hash: string }>('SELECT code_hash FROM pairing_codes WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2', [sha((b.code ?? '').toUpperCase()), now()]);
      if (!code) return { status: 403, body: { error: 'invalid_or_expired_code' } };
      const [existing] = await tx.query('SELECT id FROM devices WHERE id = $1', [b.deviceId]);
      if (!existing) {
        const [clash] = await tx.query('SELECT id FROM devices WHERE order_prefix = $1', [b.orderPrefix]);
        if (clash) return { status: 409, body: { error: 'prefix_taken' } };
        await tx.query("SELECT set_config('tillbox.origin',$1,true)", [b.deviceId]);
        await tx.query('INSERT INTO devices (id, name, order_prefix, device_id) VALUES ($1,$2,$3,$1)', [b.deviceId, b.name, b.orderPrefix]);
      }
      const token = randomBytes(32).toString('hex');
      await tx.query('UPDATE device_tokens SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [b.deviceId]);
      await tx.query('INSERT INTO device_tokens (device_id, token_hash) VALUES ($1,$2)', [b.deviceId, sha(token)]);
      await tx.query('UPDATE pairing_codes SET used_at = now() WHERE code_hash = $1', [code.code_hash]);
      return { status: 200, body: { token, storeId: await getMeta(tx, 'store_id') } };
    });
    if (result.status === 403) attempts.push(now().getTime());
    return result;
  }

  const gate = async (auth: string | null | undefined, clientSchema: string | null | undefined): Promise<{ device: string } | Reply> => {
    const device = await deviceFor(auth);
    if (!device) return { status: 401, body: { error: 'unauthorized' } };
    if (clientSchema !== SCHEMA_VERSION) return { status: 426, body: { error: 'schema_mismatch', server: SCHEMA_VERSION, client: clientSchema ?? null } };
    return { device };
  };
  const isReply = (x: unknown): x is Reply => typeof x === 'object' && x !== null && 'status' in x;

  async function push(auth: string | null | undefined, schema: string | null | undefined, b: { changes: Change[] }): Promise<Reply> {
    const g = await gate(auth, schema); if (isReply(g)) return g;
    await applyChanges(db, b.changes, { as: 'server', origin: g.device });
    await reconcileDuplicateSkus(db, (await getMeta(db, 'device_id'))!);
    return { status: 200, body: { ok: true, applied: b.changes.length } };
  }

  async function pull(auth: string | null | undefined, schema: string | null | undefined, since: number, limit: number): Promise<Reply> {
    const g = await gate(auth, schema); if (isReply(g)) return g;
    // One statement = one snapshot: the page and the high-water mark cannot disagree, so no change is skipped.
    const rows = await db.query<{ seq: number; table_name: string; op: string; payload: Record<string, unknown>; origin: string; mx: number | null }>(
      `SELECT seq, table_name, op, payload, origin, (SELECT max(seq) FROM outbox)::bigint AS mx
         FROM outbox WHERE seq > $1 AND origin <> $2 ORDER BY seq LIMIT $3`, [since, g.device, limit + 1]);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    let cursor = page.length ? Number(page[page.length - 1].seq) : since;
    if (!hasMore) {
      const mx = rows.length ? Number(rows[0].mx) : Number((await db.query<{ mx: number | null }>('SELECT max(seq)::bigint AS mx FROM outbox'))[0].mx ?? since);
      cursor = Math.max(cursor, mx);
    }
    return { status: 200, body: { changes: page.map((r) => ({ seq: Number(r.seq), table: r.table_name, op: r.op, payload: r.payload, origin: r.origin })), hasMore, cursor } };
  }

  return { isAdmin, info, createPairingCode, revokeDevice, pair, push, pull };
}
