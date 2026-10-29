// The installer is the only code (besides tests) allowed to import src/seed. It runs once, when a person chooses
// "Start a new store". Everything it writes is ordinary data that Settings can change afterwards.
import type { Db } from '../db/types';
import { installDefaults } from '../seed';

export async function startNewStore(db: Db, deviceId: string): Promise<boolean> {
  return installDefaults(db, deviceId);
}
