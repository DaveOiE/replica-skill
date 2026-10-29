// Offline devices cannot enforce business uniqueness (two tills can both create "SKU 1001" before they ever meet).
// So the database allows duplicates, and these rules resolve or report them after sync. Every device and the server
// run the same rules on the same data, so they reach the same answer.
import type { Db } from '../db/types';

/**
 * Same SKU (ignoring case and spaces) means the same product. The product with the smallest id wins on every
 * device; the others are folded into it by a `product_merges` row whose id is the loser's id, so every device
 * writing the same merge is harmless. History is untouched: old orders keep pointing at the loser's id.
 */
export async function reconcileDuplicateSkus(db: Db, deviceId: string): Promise<number> {
  const groups = await db.query<{ ids: string[] }>(
    `SELECT array_agg(p.id ORDER BY p.id::text) AS ids FROM products p
      WHERE p.active AND btrim(p.sku) <> '' AND NOT EXISTS (SELECT 1 FROM product_merges m WHERE m.id = p.id)
      GROUP BY lower(btrim(p.sku)) HAVING count(*) > 1`);
  let merged = 0;
  for (const g of groups) {
    const [winner, ...losers] = g.ids;
    for (const loser of losers) {
      await db.query(
        `INSERT INTO product_merges (id, winner_id, reason, device_id) VALUES ($1, $2, 'same_sku', $3) ON CONFLICT (id) DO NOTHING`,
        [loser, winner, deviceId]);
      merged++;
    }
  }
  return merged;
}

/** SQL for "the product this id ultimately resolves to", following chains (a winner can itself later lose). */
export const PRODUCT_ROOT_CTE = `
  WITH RECURSIVE root(id, root_id, depth) AS (
    SELECT p.id, p.id, 0 FROM products p
    UNION ALL
    SELECT root.id, m.winner_id, root.depth + 1 FROM root JOIN product_merges m ON m.id = root.root_id WHERE root.depth < 20
  ), product_root AS (SELECT DISTINCT ON (id) id, root_id FROM root ORDER BY id, depth DESC)`;

export interface KeyException { kind: 'barcode' | 'username' | 'role_key' | 'open_register_sessions'; key: string; ids: string[] }

/** Clashes that need a human. Returned, never auto-fixed: merging two different products by barcode could be wrong. */
export async function keyExceptions(db: Db): Promise<KeyException[]> {
  const out: KeyException[] = [];
  const q = async (kind: KeyException['kind'], sql: string) => {
    for (const r of await db.query<{ key: string; ids: string[] }>(sql)) out.push({ kind, key: r.key, ids: r.ids });
  };
  await q('barcode', `SELECT pu.barcode AS key, array_agg(pu.id::text ORDER BY pu.id::text) AS ids FROM product_units pu JOIN products p ON p.id = pu.product_id
                       WHERE pu.barcode IS NOT NULL AND pu.barcode <> '' AND p.active AND NOT EXISTS (SELECT 1 FROM product_merges m WHERE m.id = p.id)
                       GROUP BY pu.barcode HAVING count(DISTINCT pu.product_id) > 1`);
  await q('username', `SELECT lower(username) AS key, array_agg(id::text ORDER BY id::text) AS ids FROM users WHERE active GROUP BY lower(username) HAVING count(*) > 1`);
  await q('role_key', `SELECT key, array_agg(id::text ORDER BY id::text) AS ids FROM roles WHERE active GROUP BY key HAVING count(*) > 1`);
  await q('open_register_sessions', `SELECT register_id::text AS key, array_agg(id::text ORDER BY id::text) AS ids FROM register_sessions WHERE status = 'open' GROUP BY register_id HAVING count(*) > 1`);
  return out;
}

