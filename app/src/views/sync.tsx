'use client';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { useSession } from '../client/session';
import { useSyncStatus } from '../client/hooks';
import { connectServer, disconnectServer, syncOnce, StoreMergeError } from '../sync/client';

export default function SyncPage() {
  const { t, lang } = useI18n(); const { local } = useSession();
  const status = useSyncStatus();
  const [url, setUrl] = useState(''); const [code, setCode] = useState('');
  const [ask, setAsk] = useState<null | 'server_has_other_data' | 'different_store'>(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  if (!local) return null;

  const connect = async (confirm?: 'merge' | 'migrate') => {
    setBusy(true); setMsg('');
    try { await connectServer(local.db, { url, pairingCode: code, confirm }); setAsk(null); await syncOnce(local.db); setMsg('OK'); }
    catch (e) { if (e instanceof StoreMergeError) setAsk(e.reason); else setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void connect(); };
  const syncNow = async () => { setBusy(true); setMsg(''); try { const r = await syncOnce(local.db); setMsg(`↑ ${r.pushed}  ↓ ${r.pulled}`); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  return (
    <div className="stack">
      <h1>{t('sync.page.title')}</h1>
      <section className="card"><dl className="kv">
        <dt>{t('home.mode')}</dt><dd data-testid="sync-mode">{status?.mode ?? '…'}</dd>
        <dt>State</dt><dd data-testid="sync-detail-state">{status?.state ?? '…'}</dd>
        <dt>Waiting</dt><dd data-testid="sync-pending">{status?.pending ?? 0}</dd>
        <dt>{t('sync.lastSynced', { time: '' })}</dt><dd>{status?.lastSyncAt ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(status.lastSyncAt)) : t('sync.never')}</dd>
        {status?.lastError && <><dt>Error</dt><dd data-testid="sync-error">{status.lastError}</dd></>}
      </dl></section>
      {status?.mode === 'connected' ? (
        <section className="card row">
          <button className="btn primary" onClick={syncNow} disabled={busy} data-testid="sync-now">{t('sync.page.syncNow')}</button>
          <button className="btn danger" onClick={async () => { await disconnectServer(local.db); }} data-testid="disconnect">{t('sync.page.disconnect')}</button>
          <span role="status" data-testid="sync-msg">{msg}</span>
        </section>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <div className="field"><label htmlFor="su">{t('sync.page.url')}</label><input id="su" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:4100" data-testid="server-url" /></div>
          <div className="field"><label htmlFor="sc">{t('sync.page.code')}</label><input id="sc" className="input" value={code} onChange={(e) => setCode(e.target.value)} data-testid="pairing-code" /><span className="hint">{t('sync.page.pairHelp')}</span></div>
          <button className="btn primary" disabled={busy || !url || !code} data-testid="connect">{t('sync.page.connect')}</button>
          <p role="alert" data-testid="sync-msg">{msg}</p>
        </form>
      )}
      {ask && (
        <div className="banner warn" role="alertdialog" data-testid="merge-ask">
          <span>{ask === 'different_store' ? t('sync.page.differentAsk') : t('sync.page.mergeAsk')}</span>
          <button className="btn small" onClick={() => connect(ask === 'different_store' ? 'migrate' : 'merge')} data-testid="merge-yes">{ask === 'different_store' ? t('sync.page.migrate') : t('sync.page.merge')}</button>
          <button className="btn small" onClick={() => setAsk(null)}>{t('common.cancel')}</button>
        </div>
      )}
    </div>
  );
}
