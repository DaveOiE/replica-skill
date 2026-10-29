'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useSession } from '../client/session';
import { useBackupStatus } from '../client/hooks';
import { BackupBadge } from '../ui/shell';
import { backupToFile, backupToS3 } from '../services/backups';
import { importLogicalExport } from '../backup/backup';
import { readHeader, validateBackupPassphrase } from '../backup/crypto';
import { changeLock } from '../security/lock';
import { SaveCancelled } from '../backup/destinations/file';
import type { S3Config } from '../backup/s3';
import { AUTO_PASS } from '../client/auto-backup';

const EMPTY_S3: S3Config = { endpoint: '', region: '', bucket: '', prefix: '', accessKeyId: '', secretAccessKey: '' };

export default function DataSafety() {
  const { t, lang } = useI18n(); const { local, ctx, vault } = useSession();
  const status = useBackupStatus();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [pass, setPass] = useState(''); const [kind, setKind] = useState<'physical' | 'logical'>('physical');
  const [s3, setS3] = useState<S3Config>(EMPTY_S3); const [s3Msg, setS3Msg] = useState(''); const [auto, setAuto] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const [oldPin, setOldPin] = useState(''); const [newPin, setNewPin] = useState(''); const [pinMsg, setPinMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null); const [fileInfo, setFileInfo] = useState(''); const [rpass, setRpass] = useState(''); const [restoreMsg, setRestoreMsg] = useState('');

  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)); }, []);
  useEffect(() => { vault?.open('s3').then((v) => { if (v) setS3(JSON.parse(v)); }).catch(() => {}); vault?.open(AUTO_PASS).then((v) => setAuto(!!v)).catch(() => {}); }, [vault]);
  if (!local || !ctx) return null;

  const passProblem = pass ? validateBackupPassphrase(pass) : null;
  const run = async (f: () => Promise<{ bytes: number }>) => {
    setBusy(true); setResult(null);
    try { const r = await f(); setResult({ ok: true, text: t('ds.result.ok', { bytes: r.bytes }) }); }
    catch (e) { if (!(e instanceof SaveCancelled)) setResult({ ok: false, text: t('ds.result.fail', { error: e instanceof Error ? e.message : String(e) }) }); }
    finally { setBusy(false); }
  };
  const saveS3 = async () => {
    if (!vault) return setS3Msg(t('ds.needUnlock'));
    await vault.seal('s3', JSON.stringify(s3));
    if (auto) { if (!pass || passProblem) return setS3Msg(t('ds.autoNeedPass')); await vault.seal(AUTO_PASS, pass); } else await vault.forget(AUTO_PASS);
    setS3Msg(t('ds.s3Saved'));
  };
  const onFile = () => {
    const f = fileRef.current?.files?.[0]; setFileInfo('');
    f?.arrayBuffer().then((b) => { const h = readHeader(new Uint8Array(b)); setFileInfo(t('ds.fileInfo', { kind: h.kind, when: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(h.createdAt)) })); }).catch((e) => setFileInfo(String(e.message)));
  };
  const restore = async () => {
    const f = fileRef.current?.files?.[0]; if (!f) return; setBusy(true); setRestoreMsg(t('common.working'));
    try { const r = await importLogicalExport(local.db, new Uint8Array(await f.arrayBuffer()), rpass); setRestoreMsg(t('ds.restored', { rows: r.rows })); }
    catch (e) { setRestoreMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <h1>{t('ds.title')}</h1>
      {status && <p><BackupBadge status={status} /></p>}

      <section className="card stack" aria-labelledby="ds-storage"><h2 id="ds-storage">{t('ds.storage')}</h2>
        <p data-testid="persist-state">{persisted ? t('ds.persisted') : t('ds.notPersisted')}</p>
        {!persisted && <button className="btn" onClick={async () => setPersisted(await navigator.storage.persist())} data-testid="ask-persist">{t('ds.askPersist')}</button>}
      </section>

      <section className="card stack" aria-labelledby="ds-pin"><h2 id="ds-pin">{t('ds.pin')}</h2>
        <p data-testid="pin-state">{t('ds.pinSet')}</p>
        <div className="field"><label htmlFor="op">{t('pin.label')} (current)</label><input id="op" className="input" type="password" value={oldPin} onChange={(e) => setOldPin(e.target.value)} data-testid="pin-old" /></div>
        <div className="field"><label htmlFor="np">{t('pin.label')} (new)</label><input id="np" className="input" type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} data-testid="pin-new" /></div>
        <button className="btn" onClick={async () => { try { await changeLock(local.db, oldPin, newPin); setPinMsg('OK'); setOldPin(''); setNewPin(''); } catch (e) { setPinMsg(e instanceof Error ? e.message : String(e)); } }} data-testid="pin-change">{t('ds.pinChange')}</button>
        <p role="status" data-testid="pin-change-msg">{pinMsg}</p>
      </section>

      <section className="card stack" aria-labelledby="ds-backup"><h2 id="ds-backup">{t('ds.backup')}</h2>
        <div className="field"><label htmlFor="bp">{t('ds.passphrase')}</label>
          <input id="bp" className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} data-testid="backup-pass" />
          <span className="hint">{t('ds.passphraseHelp')}</span>{passProblem && <span className="hint" role="alert" data-testid="backup-pass-problem">{passProblem}</span>}</div>
        <div className="field"><label htmlFor="bk">{t('ds.kind')}</label>
          <select id="bk" className="input" value={kind} onChange={(e) => setKind(e.target.value as 'physical' | 'logical')} data-testid="backup-kind">
            <option value="physical">{t('ds.kindPhysical')}</option><option value="logical">{t('ds.kindLogical')}</option></select></div>
        <div className="row">
          <button className="btn primary" disabled={busy || !pass || !!passProblem} data-testid="backup-file" onClick={() => run(() => backupToFile(ctx, local.pg, { passphrase: pass, kind, prefer: new URLSearchParams(location.search).get('save') === 'download' ? 'download' : undefined }))}>{t('ds.toDevice')}</button>
          <button className="btn" disabled={busy || !pass || !!passProblem || !s3.endpoint} data-testid="backup-s3" onClick={() => run(() => backupToS3(ctx, local.pg, { passphrase: pass, kind, s3 }))}>{t('ds.toS3')}</button>
        </div>
        <p role="status" data-testid="backup-result" className={result?.ok ? '' : ''}>{result?.text}</p>
      </section>

      <section className="card stack" aria-labelledby="ds-s3"><h2 id="ds-s3">{t('ds.s3')}</h2>
        <p className="hint">{t('ds.s3Help')}</p>
        {(['endpoint', 'region', 'bucket', 'prefix', 'accessKeyId', 'secretAccessKey'] as const).map((k) => (
          <div className="field" key={k}><label htmlFor={'s3' + k}>{t(({ endpoint: 'ds.endpoint', region: 'ds.region', bucket: 'ds.bucket', prefix: 'ds.prefix', accessKeyId: 'ds.keyId', secretAccessKey: 'ds.secret' } as const)[k])}</label>
            <input id={'s3' + k} className="input" type={k === 'secretAccessKey' ? 'password' : 'text'} value={s3[k] ?? ''} onChange={(e) => setS3({ ...s3, [k]: e.target.value })} data-testid={'s3-' + k} /></div>
        ))}
        <label className="row"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} data-testid="s3-auto" /> <span>{t('ds.auto')}</span></label>
        <span className="hint">{t('ds.autoHelp')}</span>
        <button className="btn" onClick={saveS3} data-testid="s3-save">{t('ds.saveS3')}</button>
        <p role="status" data-testid="s3-msg">{s3Msg}</p>
      </section>

      <section className="card stack" aria-labelledby="ds-restore"><h2 id="ds-restore">{t('ds.restore')}</h2>
        <p className="hint">{t('ds.restoreHelp')}</p>
        <div className="field"><label htmlFor="rf">{t('ds.chooseFile')}</label><input id="rf" ref={fileRef} type="file" accept=".tbx" className="input" onChange={onFile} data-testid="restore-file" /><span className="hint" data-testid="file-info">{fileInfo}</span></div>
        <div className="field"><label htmlFor="rpw">{t('ds.passphrase')}</label><input id="rpw" className="input" type="password" value={rpass} onChange={(e) => setRpass(e.target.value)} data-testid="restore-pass" /></div>
        <button className="btn" disabled={busy || !rpass} onClick={restore} data-testid="restore-go">{t('ds.restoreNow')}</button>
        <p role="status" data-testid="restore-msg">{restoreMsg}</p>
      </section>
    </div>
  );
}
