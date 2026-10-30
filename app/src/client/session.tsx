'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { openLocal, isSetUp, OpenElsewhereError, type Local } from './localdb';
import { isLockSet, setupLock, unlock as unlockWith, createInactivityLock, type Vault } from '../security/lock';
import { createBus } from '../events/bus';
import { startNewStore } from '../installer';
import { flush } from '../db/durability';
import { getSetting } from '../settings/service';
import type { Ctx } from '../services/runner';

export type Phase = 'opening' | 'elsewhere' | 'first-run' | 'set-pin' | 'locked' | 'ready' | 'error';
interface Session {
  phase: Phase; error: string | null; local: Local | null; vault: Vault | null; ctx: Ctx | null;
  startNewStore(): Promise<void>; markJoined(): void; setPin(pin: string): Promise<void>; unlock(pin: string): Promise<void>; lock(): void; reopen(): void;
}
const C = createContext<Session | null>(null);
export const useSession = (): Session => { const c = useContext(C); if (!c) throw new Error('SessionProvider missing'); return c; };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('opening');
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Local | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const bus = useRef(createBus((n, e) => console.warn('handler failed', n, e))).current;
  const idle = useRef<ReturnType<typeof createInactivityLock> | null>(null);

  const decide = useCallback(async (l: Local, v: Vault | null) => {
    if (!(await isSetUp(l.db))) return setPhase('first-run');
    if (!(await isLockSet(l.db))) return setPhase('set-pin');
    setPhase(v ? 'ready' : 'locked');
  }, []);

  const reopen = useCallback(() => {
    setPhase('opening');
    openLocal().then(async (l) => { setLocal(l); await decide(l, null); }).catch((e) => {
      if (e instanceof OpenElsewhereError) setPhase('elsewhere'); else { setError(e instanceof Error ? e.message : String(e)); setPhase('error'); }
    });
  }, [decide]);
  useEffect(reopen, [reopen]);

  const lock = useCallback(() => { idle.current?.stop(); setVault(null); if (local) { void flush(local.db); setPhase('locked'); } }, [local]);

  // lock after a period with no taps or keys (the period is a setting)
  useEffect(() => {
    if (phase !== 'ready' || !local) return;
    let off = () => {};
    getSetting(local.db, 'security').then((s) => {
      const il = createInactivityLock({ minutes: s.lockAfterMinutes, onLock: lock });
      idle.current = il; il.touch();
      const touch = () => il.touch();
      const evs = ['pointerdown', 'keydown'] as const;
      evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
      off = () => { il.stop(); evs.forEach((e) => window.removeEventListener(e, touch)); };
    }).catch(() => {});
    return () => off();
  }, [phase, local, lock]);

  const value = useMemo<Session>(() => ({
    phase, error, local, vault,
    ctx: local ? { db: local.db, bus, deviceId: local.info.id, actor: 'system' } : null,
    async startNewStore() { if (!local) return; await startNewStore(local.db, local.info.id); await decide(local, vault); },
    markJoined() { if (local) void decide(local, vault); },
    async setPin(pin) { if (!local) return; const v = await setupLock(local.db, pin); setVault(v); setPhase('ready'); },
    async unlock(pin) { if (!local) return; const v = await unlockWith(local.db, pin); setVault(v); setPhase('ready'); },
    lock, reopen,
  }), [phase, error, local, vault, bus, decide, lock, reopen]);

  return <C.Provider value={value}>{children}</C.Provider>;
}
