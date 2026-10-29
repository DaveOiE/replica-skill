'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import IntlMessageFormat from 'intl-messageformat';
import en from './en.json';
import ar from './ar.json';

export type Lang = 'en' | 'ar';
export const LANGS: { code: Lang; label: string; dir: 'ltr' | 'rtl' }[] = [{ code: 'en', label: 'English', dir: 'ltr' }, { code: 'ar', label: 'العربية', dir: 'rtl' }];
const CATALOGS: Record<Lang, Record<string, string>> = { en, ar };
export type MessageKey = keyof typeof en;
export type Values = Record<string, string | number | Date>;

const cache = new Map<string, IntlMessageFormat>();
/** Format a message. Falls back to English, then to the key itself, so a missing translation is visible but never blank. */
export function format(lang: Lang, key: string, values?: Values): string {
  const msg = CATALOGS[lang][key] ?? CATALOGS.en[key];
  if (msg === undefined) return key;
  const ck = `${lang}\u0000${key}`;
  let f = cache.get(ck);
  if (!f) { f = new IntlMessageFormat(msg, lang); cache.set(ck, f); }
  return String(f.format(values as never));
}

interface I18n { lang: Lang; dir: 'ltr' | 'rtl'; setLang: (l: Lang) => void; t: (key: MessageKey, values?: Values) => string }
const Ctx = createContext<I18n | null>(null);

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window: fine, it just will not be remembered */ } };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (read('tb-lang') === 'ar' ? 'ar' : 'en'));
  const dir = LANGS.find((l) => l.code === lang)!.dir;
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = dir; }, [lang, dir]);
  const setLang = useCallback((l: Lang) => { write('tb-lang', l); setLangState(l); }, []);
  const t = useCallback((key: MessageKey, values?: Values) => format(lang, key, values), [lang]);
  const value = useMemo(() => ({ lang, dir, setLang, t }), [lang, dir, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useI18n(): I18n { const c = useContext(Ctx); if (!c) throw new Error('I18nProvider missing'); return c; }
