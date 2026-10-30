'use client';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { useSession } from '../client/session';
import { usePoll } from '../client/hooks';
import { getSyncStatus } from '../sync/client';
import { getSetting } from '../settings/service';
import { stockExceptions, stockGrid, createSimpleProduct } from '../services/catalogue';
import { keyExceptions } from '../sync/reconcile';
import { createSale } from '../services/sales';
import { formatMoney } from '../domain/format';
import { flush } from '../db/durability';

export default function Home() {
  const { t } = useI18n(); const { local, ctx } = useSession();
  const [msg, setMsg] = useState('');
  const data = usePoll(async () => {
    if (!local) return null as never;
    const one = async (sql: string) => Number((await local.db.query<{ n: number }>(sql))[0].n);
    return {
      status: await getSyncStatus(local.db, navigator.onLine),
      products: await one("SELECT count(*)::int n FROM products WHERE active"), orders: await one('SELECT count(*)::int n FROM orders'),
      stockEx: (await stockExceptions(local.db)).length, keyEx: (await keyExceptions(local.db)).length,
    };
  }, [local]);
  if (!local || !ctx) return null;
  const d = data.value;

  const sample = async () => {
    setMsg('');
    try {
      let grid = await stockGrid(local.db, { limit: 5 });
      if (!grid.length) {
        const group = (await getSetting(local.db, 'tax')).defaultTaxGroupId;
        for (const [sku, name, price] of [['FW', 'Flat white', 450], ['CR', 'Croissant', 520], ['WA', 'Water', 300]] as const)
          await createSimpleProduct(ctx, { sku, name, priceCents: price, openingStock: 50, taxGroupId: group });
        grid = await stockGrid(local.db, { limit: 5 });
      }
      const card = (await local.db.query<{ id: string }>("SELECT id FROM payment_types WHERE key='card'"))[0].id;
      const lines = grid.slice(0, 2).map((g) => ({ productUnitId: g.product_unit_id, qty: 1 }));
      const { quoteSale } = await import('../services/sales');
      const q = await quoteSale(local.db, { lines });
      const r = await createSale(ctx, { lines, payments: [{ paymentTypeId: card, amountCents: q.totalCents }] });
      await flush(local.db);   // only tell the customer "recorded" once it is safely in browser storage
      const cur = await getSetting(local.db, 'currency');
      setMsg(t('home.sampleDone', { number: r.number, total: formatMoney(r.totalCents, cur) }));
      data.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="stack">
      <h1>{t('home.title')}</h1>
      <div className="grid">
        <section className="card" aria-labelledby="h-dev"><h2 id="h-dev">{t('home.device')}</h2>
          <dl className="kv">
            <dt>{t('home.name')}</dt><dd data-testid="dev-name">{local.info.name}</dd>
            <dt>{t('home.prefix')}</dt><dd className="mono" data-testid="prefix">{local.info.prefix}</dd>
            <dt>{t('home.mode')}</dt><dd data-testid="mode">{d?.status.mode === 'connected' ? t('home.modeConnected') : t('home.modeStandalone')}</dd>
          </dl></section>
        <section className="card" aria-labelledby="h-rec"><h2 id="h-rec">{t('home.records')}</h2>
          <dl className="kv"><dt>{t('home.products')}</dt><dd data-testid="count-products">{d?.products ?? '…'}</dd><dt>{t('home.orders')}</dt><dd data-testid="count-orders">{d?.orders ?? '…'}</dd></dl></section>
        <section className="card" aria-labelledby="h-ex"><h2 id="h-ex">{t('home.exceptions')}</h2>
          <p data-testid="stock-ex">{t('home.stockExceptions', { count: d?.stockEx ?? 0 })}</p><p data-testid="key-ex">{t('home.keyExceptions', { count: d?.keyEx ?? 0 })}</p></section>
      </div>
      <section className="card stack">
        <button className="btn primary" onClick={sample} data-testid="sample-sale">{t('home.sample')}</button>
        <p className="hint">{t('home.sampleHelp')}</p>
        <p role="status" data-testid="sample-msg">{msg}</p>
      </section>
    </div>
  );
}
