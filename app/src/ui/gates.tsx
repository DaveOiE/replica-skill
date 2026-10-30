'use client';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { useSession } from '../client/session';
import { LockedOutError, WrongPinError, WeakPinError } from '../security/lock';
import { openPhysicalBackup, loadPhysicalData } from '../backup/backup';
import { readHeader } from '../backup/crypto';
import { wipeLocal } from '../client/localdb';
import { restoreAsNewDevice } from '../domain/store';
import { fromPglite, closePglite } from '../db/pglite';
import { StoreMergeError, connectServer } from '../sync/client';

export function LockScreen() {
  const { t } = useI18n(); const { unlock } = useSession();
  const [pin, setPin] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg('');
    try { await unlock(pin); }
    catch (err) {
      if (err instanceof LockedOutError) setMsg(t('lock.wait', { seconds: Math.max(1, Math.ceil((err.untilMs - Date.now()) / 1000)) }));
      else if (err instanceof WrongPinError) setMsg(t('lock.wrong', { left: err.attemptsLeftBeforeDelay }));
      else setMsg(err instanceof Error ? err.message : String(err));
      setPin('');
    } finally { setBusy(false); }
  };
  return (
    <div className="lockscreen" data-testid="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-h">
      <form className="card panel stack" onSubmit={go}>
        <h1 id="lock-h">{t('lock.title')}</h1>
        <div className="field"><label htmlFor="pin">{t('pin.label')}</label>
          <input id="pin" className="input" type="password" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} data-testid="unlock-pin" /></div>
        <button className="btn primary" disabled={busy || !pin} data-testid="unlock-go">{t('lock.unlock')}</button>
        <p role="alert" className="hint" data-testid="lock-msg">{msg}</p>
        <p className="hint">{t('lock.honest')}</p>
      </form>
    </div>
  );
}

export function SetPin() {
  const { t } = useI18n(); const { setPin } = useSession();
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault(); setMsg('');
    if (a !== b) return setMsg(t('pin.mismatch'));
    setBusy(true);
    try { await setPin(a); } catch (err) { setMsg(err instanceof WeakPinError || err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return (
    <Center>
      <form className="card panel stack" onSubmit={go}>
        <h1>{t('first.pinTitle')}</h1><p className="muted">{t('first.pinHelp')}</p>
        <div className="field"><label htmlFor="p1">{t('pin.label')}</label><input id="p1" className="input" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} data-testid="pin-1" /></div>
        <div className="field"><label htmlFor="p2">{t('pin.confirm')}</label><input id="p2" className="input" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} data-testid="pin-2" /></div>
        <button className="btn primary" disabled={busy || !a} data-testid="pin-set">{t('pin.set')}</button>
        <p role="alert" className="hint" data-testid="pin-msg">{msg}</p>
        <p className="hint">{t('lock.honest')}</p>
      </form>
    </Center>
  );
}

export const Center = ({ children }: { children: ReactNode }) => <div className="center"><div className="panel">{children}</div></div>;

type Mode = 'menu' | 'join' | 'restore';
export function FirstRun() {
  const { t } = useI18n(); const { startNewStore, markJoined, local } = useSession();
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  // join
  const [url, setUrl] = useState(''); const [code, setCode] = useState('');
  // restore
  const fileRef = useRef<HTMLInputElement>(null); const [pass, setPass] = useState(''); const [asNew, setAsNew] = useState(true);

  const join = async (e: FormEvent) => {
    e.preventDefault(); if (!local) return; setBusy(true); setMsg('');
    try { await connectServer(local.db, { url, pairingCode: code }); markJoined(); }
    catch (err) { setMsg(err instanceof StoreMergeError ? err.message : err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  const restore = async (e: FormEvent) => {
    e.preventDefault(); const file = fileRef.current?.files?.[0]; if (!file || !local) return; setBusy(true); setMsg(t('common.working'));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const head = readHeader(bytes);
      if (head.kind !== 'physical') throw new Error('Only a snapshot can be restored on a new device from here. Use a snapshot file.');
      // prove the file and the passphrase are good BEFORE touching anything on this device
      const data = await openPhysicalBackup(bytes, pass);
      const dataDir = local.dataDir;
      await wipeLocal(local);
      const pg = loadPhysicalData(data, dataDir);
      if (asNew) await restoreAsNewDevice(fromPglite(pg), 'Till (restored)');
      await closePglite(pg);
      location.reload();
    } catch (err) { setMsg(err instanceof Error ? err.message : String(err)); setBusy(false); }
  };

  return (
    <Center>
      <div className="card stack" data-testid="first-run">
        <h1>{t('first.title')}</h1>
        {mode === 'menu' && (<>
          <button className="btn primary" onClick={async () => { setBusy(true); await startNewStore(); }} disabled={busy} data-testid="first-new">{t('first.new')}</button><p className="hint">{t('first.newHelp')}</p>
          <button className="btn" onClick={() => setMode('join')} data-testid="first-join">{t('first.join')}</button><p className="hint">{t('first.joinHelp')}</p>
          <button className="btn" onClick={() => setMode('restore')} data-testid="first-restore">{t('first.restore')}</button><p className="hint">{t('first.restoreHelp')}</p>
        </>)}
        {mode === 'join' && (
          <form className="stack" onSubmit={join}>
            <div className="field"><label htmlFor="u">URL</label><input id="u" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:4100" data-testid="join-url" /></div>
            <div className="field"><label htmlFor="c">{t('sync.page.code')}</label><input id="c" className="input" value={code} onChange={(e) => setCode(e.target.value)} data-testid="join-code" /></div>
            <p className="hint">{t('sync.page.pairHelp')}</p>
            <div className="row"><button className="btn primary" disabled={busy} data-testid="join-go">{t('common.continue')}</button><button type="button" className="btn" onClick={() => setMode('menu')}>{t('common.cancel')}</button></div>
          </form>
        )}
        {mode === 'restore' && (
          <form className="stack" onSubmit={restore}>
            <div className="field"><label htmlFor="f">{t('ds.chooseFile')}</label><input id="f" ref={fileRef} type="file" accept=".tbx" className="input" data-testid="restore-file" /></div>
            <div className="field"><label htmlFor="rp">{t('ds.passphrase')}</label><input id="rp" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} data-testid="restore-pass" /></div>
            <label className="row"><input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} data-testid="restore-new" /> <span>New device identity (recommended). Untick only if the original device is gone for good.</span></label>
            <div className="row"><button className="btn primary" disabled={busy} data-testid="restore-go">{t('common.continue')}</button><button type="button" className="btn" onClick={() => setMode('menu')}>{t('common.cancel')}</button></div>
          </form>
        )}
        <p role="alert" className="hint" data-testid="first-msg">{msg}</p>
      </div>
    </Center>
  );
}
