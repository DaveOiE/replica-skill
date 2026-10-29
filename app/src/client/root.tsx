'use client';
import { useEffect, type ReactNode } from 'react';
import '../styles/app.css';
import { I18nProvider, useI18n } from '../i18n';
import { ThemeProvider } from '../ui/theme';
import { SessionProvider, useSession } from './session';
import { AppShell } from '../ui/shell';
import { FirstRun, LockScreen, SetPin, Center } from '../ui/gates';

function Gate({ children }: { children: ReactNode }) {
  const { t } = useI18n(); const { phase, error, reopen } = useSession();
  if (phase === 'opening') return <Center><p data-testid="opening" role="status">{t('app.opening')}</p></Center>;
  if (phase === 'elsewhere') return <Center><div className="card stack" data-testid="open-elsewhere"><h1>{t('app.name')}</h1><p>This shop is already open in another window on this device. Close that window, or use it.</p><button className="btn" onClick={reopen}>Try again</button></div></Center>;
  if (phase === 'error') return <Center><div className="banner bad" role="alert" data-testid="fatal">{error}</div></Center>;
  if (phase === 'first-run') return <FirstRun />;
  if (phase === 'set-pin') return <SetPin />;
  if (phase === 'locked') return <LockScreen />;
  return <AppShell>{children}</AppShell>;
}

export default function Root({ children }: { children: ReactNode }) {
  // Cache the whole app so it opens with no network. Registration failure is harmless: the app still works online.
  useEffect(() => { if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []);
  return (<I18nProvider><ThemeProvider><SessionProvider><Gate>{children}</Gate></SessionProvider></ThemeProvider></I18nProvider>);
}
