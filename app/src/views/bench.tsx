'use client';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { runBench, type BenchResult } from '../client/bench';

export default function Bench() {
  const { t } = useI18n();
  const [n, setN] = useState(2000); const [dur, setDur] = useState<'strict' | 'relaxed'>('relaxed'); const [step, setStep] = useState(''); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BenchResult | null>(null); const [err, setErr] = useState('');
  const json = res ? JSON.stringify(res, null, 2) : '';
  const run = async () => {
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await runBench({ products: n, durability: dur, onStep: setStep })); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setStep(''); }
  };
  return (
    <div className="stack">
      <h1>{t('bench.title')}</h1>
      <p className="muted">{t('bench.help')}</p>
      <div className="card stack">
        <div className="field"><label htmlFor="bn">{t('bench.products')}</label>
          <select id="bn" className="input" value={n} onChange={(e) => setN(Number(e.target.value))} data-testid="bench-n">{[500, 2000, 5000, 10000].map((x) => <option key={x} value={x}>{x.toLocaleString()}</option>)}</select></div>
        <div className="field"><label htmlFor="bd">Storage mode</label>
          <select id="bd" className="input" value={dur} onChange={(e) => setDur(e.target.value as 'strict' | 'relaxed')} data-testid="bench-durability"><option value="relaxed">Write-behind (what the app uses): saved shortly after, confirmed once safe</option><option value="strict">Strict: saved after every statement (slow; for comparison)</option></select></div>
        <button className="btn primary" onClick={run} disabled={busy} data-testid="bench-run">{t('bench.run')}</button>
        {busy && <p role="status" data-testid="bench-step">{t('bench.running')} {step}</p>}
        {err && <p role="alert" data-testid="bench-error">{err}</p>}
      </div>
      {res && (
        <div className="card stack">
          <pre className="out mono" data-testid="bench-result" tabIndex={0}>{json}</pre>
          <div className="row">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>{t('bench.copy')}</button>
            <a className="btn" download="tillbox-device-speed.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(json)}>{t('bench.download')}</a>
          </div>
        </div>
      )}
    </div>
  );
}
