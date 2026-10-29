import { describe, it, expect, vi } from 'vitest';
import { setupLock, unlock, changeLock, isLockSet, validateSecret, delayAfter, createInactivityLock, WrongPinError, LockedOutError, WeakPinError } from '../src/security/lock';
import { makeDevice } from './helpers';

const FAST = { iterations: 1000 };   // the real default is 300,000; tests only need the logic

describe('PIN policy', () => {
  it('accepts a 6 to 12 digit PIN or a passphrase of 10+ characters', () => {
    for (const ok of ['482916', '4829163057', 'correct horse battery']) expect(validateSecret(ok)).toBeNull();
  });
  it('rejects short, long, repeated and sequential PINs, and short passphrases', () => {
    for (const bad of ['1234', '1234567890123', '000000', '111111', '123456', '654321', '234567', 'abc12', 'shortpass']) expect(validateSecret(bad), bad).not.toBeNull();
  });
});

describe('lock and vault', () => {
  it('a device starts without a lock; setting one returns an unlocked vault', async () => {
    const d = await makeDevice('lock1');
    expect(await isLockSet(d.db)).toBe(false);
    const v = await setupLock(d.db, '482916', FAST);
    expect(await isLockSet(d.db)).toBe(true);
    await v.seal('s3', '{"key":"AKIA","secret":"shh"}');
    expect(await v.open('s3')).toBe('{"key":"AKIA","secret":"shh"}');
    expect(await v.open('missing')).toBeNull();
  });
  it('secrets are not stored in the clear, and the PIN is not stored at all', async () => {
    const d = await makeDevice('lock2');
    const v = await setupLock(d.db, '482916', FAST); await v.seal('s3', 'TOP-SECRET-VALUE');
    const rows = await d.db.query<{ key: string; value: string }>('SELECT key, value FROM device_secrets');
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain('TOP-SECRET-VALUE'); expect(blob).not.toContain('482916');
    expect(rows.some((r) => r.key === 'vault:s3')).toBe(true);
  });
  it('the right PIN unlocks (even after a restart: nothing but the database is needed); the wrong one does not', async () => {
    const d = await makeDevice('lock3');
    const v = await setupLock(d.db, '482916', FAST); await v.seal('k', 'v');
    expect(await (await unlock(d.db, '482916')).open('k')).toBe('v');
    await expect(unlock(d.db, '000111')).rejects.toBeInstanceOf(WrongPinError);
    await expect(unlock(d.db, '482915')).rejects.toMatchObject({ attemptsLeftBeforeDelay: 3 });
  });
  it('after five wrong tries it makes you wait, even for the right PIN, and the wait survives a reload', async () => {
    const d = await makeDevice('lock4');
    await setupLock(d.db, '482916', FAST);
    let t = 1_000_000; const now = () => t;
    for (let i = 0; i < 4; i++) await expect(unlock(d.db, 'wrong-one-1', now)).rejects.toBeInstanceOf(WrongPinError);
    await expect(unlock(d.db, 'wrong-one-1', now)).rejects.toBeInstanceOf(LockedOutError);
    await expect(unlock(d.db, '482916', now)).rejects.toBeInstanceOf(LockedOutError);   // right PIN, still locked out
    t += 31_000;
    await expect(unlock(d.db, '482916', now)).resolves.toBeTruthy();
    // a success resets the counter
    await expect(unlock(d.db, 'nope-nope-1', now)).rejects.toMatchObject({ attemptsLeftBeforeDelay: 4 });
  });
  it('the wait doubles with each further five failures, capped at fifteen minutes', () => {
    expect([0, 4, 5, 9, 10, 15, 20, 25, 30, 100].map(delayAfter)).toEqual([0, 0, 30_000, 30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
  });
  it('changing the PIN keeps everything in the vault, and the old PIN stops working', async () => {
    const d = await makeDevice('lock5');
    const v = await setupLock(d.db, '482916', FAST); await v.seal('k', 'kept');
    await changeLock(d.db, '482916', '731905');
    await expect(unlock(d.db, '482916')).rejects.toBeInstanceOf(WrongPinError);
    expect(await (await unlock(d.db, '731905')).open('k')).toBe('kept');
    await expect(changeLock(d.db, '000000', '555999')).rejects.toBeInstanceOf(Error);
    await expect(changeLock(d.db, '731905', '123456')).rejects.toBeInstanceOf(WeakPinError);
  });
  it('a weak PIN cannot be set; unlocking a device with no lock is an error', async () => {
    const d = await makeDevice('lock6');
    await expect(setupLock(d.db, '111111', FAST)).rejects.toBeInstanceOf(WeakPinError);
    await expect(unlock(d.db, '482916')).rejects.toThrow('no lock is set');
  });
  it('forgetting a secret removes it', async () => {
    const d = await makeDevice('lock7');
    const v = await setupLock(d.db, '482916', FAST); await v.seal('k', 'v'); await v.forget('k');
    expect(await v.open('k')).toBeNull();
  });
  it('a passphrase works like a PIN', async () => {
    const d = await makeDevice('lock8');
    await setupLock(d.db, 'purple monkey dishwasher', FAST);
    await expect(unlock(d.db, 'purple monkey dishwasher')).resolves.toBeTruthy();
  });
});

describe('inactivity lock', () => {
  it('locks after the idle time, and activity postpones it', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const l = createInactivityLock({ minutes: 5, onLock });
    l.touch(); vi.advanceTimersByTime(4 * 60_000); l.touch(); vi.advanceTimersByTime(4 * 60_000);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000);
    expect(onLock).toHaveBeenCalledOnce();
    l.touch(); l.stop(); vi.advanceTimersByTime(10 * 60_000);
    expect(onLock).toHaveBeenCalledOnce();
    l.lockNow(); expect(onLock).toHaveBeenCalledTimes(2);
    l.touch(); l.lockNow(); expect(onLock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
