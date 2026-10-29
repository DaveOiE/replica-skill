'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useI18n, LANGS, type MessageKey } from '../i18n';
import { useTheme, type ThemeChoice } from './theme';
import { useSession } from '../client/session';
import { useSyncStatus, useBackupStatus } from '../client/hooks';
import { useAutoBackup } from '../client/auto-backup';

const cls = { standalone: 'info', synced: 'ok', pending: 'warn', offline: 'warn', error: 'bad', 'update-required': 'bad', unauthorised: 'bad' } as const;
const label: Record<string, MessageKey> = { standalone: 'sync.standalone', synced: 'sync.synced', pending: 'sync.pending', offline: 'sync.offline', error: 'sync.error', 'update-required': 'sync.updateRequired', unauthorised: 'sync.unauthorised' };

/** One badge, always visible: what state is my data in? Words and a shape, never colour alone. */
export function SyncBadge() {
  const { t, lang } = useI18n();
  const s = useSyncStatus(); const b = useBackupStatus();
  if (!s) return null;
  const text = s.state === 'pending' ? t('sync.pending', { count: s.pending }) : t(label[s.state]);
  const when = s.lastSyncAt ? t('sync.lastSynced', { time: new Intl.DateTimeFormat(lang, { timeStyle: 'short' }).format(new Date(s.lastSyncAt)) }) : '';
  return (
    <div className="row" role="status" aria-live="polite">
      <Link href="/sync/" className={`badge ${cls[s.state]}`} data-testid="sync-badge" title={s.lastError ?? when}>
        <span className="dot" aria-hidden="true" /><span data-testid="sync-state">{text}</span>
      </Link>
      {s.mode === 'standalone' && b && <BackupBadge status={b} />}
    </div>
  );
}

export function BackupBadge({ status }: { status: NonNullable<ReturnType<typeof useBackupStatus>> }) {
  const { t } = useI18n();
  const days = Math.floor(status.ageDays ?? 0);
  const text = status.level === 'never' ? t('backup.never') : t(`backup.${status.level}` as MessageKey, { days });
  const c = status.level === 'ok' ? 'ok' : status.level === 'due' || status.level === 'never' ? 'warn' : 'bad';
  return <Link href="/data-safety/" className={`badge ${c}`} data-testid="backup-badge"><span className="dot" aria-hidden="true" />{text}</Link>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const { lock, local } = useSession();
  const path = usePathname() ?? '/';
  const b = useBackupStatus();
  useAutoBackup();
  const nav: [string, MessageKey][] = [['/', 'nav.home'], ['/sync/', 'nav.sync'], ['/data-safety/', 'nav.dataSafety'], ['/bench/', 'nav.bench']];
  const here = (href: string) => (href === '/' ? path === '/' : path.startsWith(href.replace(/\/$/, '')));
  return (
    <div className="shell">
      <header className="top">
        <span className="brand">{t('app.name')}</span>
        <nav className="nav" aria-label="Main">
          {nav.map(([href, key]) => <Link key={href} href={href} aria-current={here(href) ? 'page' : undefined}>{t(key)}</Link>)}
        </nav>
        <SyncBadge />
        <div className="tools">
          <select className="input" style={{ inlineSize: 'auto' }} aria-label={t('tools.language')} value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'ar')} data-testid="lang">
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <select className="input" style={{ inlineSize: 'auto' }} aria-label={t('tools.theme')} value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)} data-testid="theme">
            {(['system', 'light', 'dark'] as ThemeChoice[]).map((x) => <option key={x} value={x}>{t(`theme.${x}` as MessageKey)}</option>)}
          </select>
          <button className="btn small" onClick={lock} data-testid="lock-now">{t('tools.lock')}</button>
        </div>
      </header>
      <main className="main">
        {b && (b.level === 'never' || b.level === 'warn' || b.level === 'urgent') && (
          <div className={`banner ${b.level === 'urgent' || b.level === 'never' ? 'bad' : 'warn'}`} role="alert" data-testid="backup-banner">
            <span>{b.level === 'never' ? t('backup.banner.never') : t('backup.banner.late')}</span>
            <Link href="/data-safety/">{t('backup.banner.action')}</Link>
          </div>
        )}
        {local && local.persisted === false && <div className="banner warn" data-testid="persist-banner">{t('storage.persistentNo')}</div>}
        {children}
      </main>
    </div>
  );
}
