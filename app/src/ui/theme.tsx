'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const Ctx = createContext<{ theme: ThemeChoice; setTheme: (t: ThemeChoice) => void } | null>(null);
const read = (): ThemeChoice => { try { const v = localStorage.getItem('tb-theme'); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(read);
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = theme;
  }, [theme]);
  const setTheme = useCallback((t: ThemeChoice) => { try { localStorage.setItem('tb-theme', t); } catch { /* not remembered */ } setThemeState(t); }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useTheme() { const c = useContext(Ctx); if (!c) throw new Error('ThemeProvider missing'); return c; }
