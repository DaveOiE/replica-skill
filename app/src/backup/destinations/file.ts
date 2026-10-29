// Save a backup to the device. Browsers differ, so three routes, best first:
//  1. the save-file dialog (Chrome/Edge on desktop and Android) - the user picks the folder
//  2. the share sheet (iOS/iPadOS Safari, some Android) - the user picks "Save to Files", Drive, a USB drive...
//  3. a plain download - works everywhere
// Nothing here talks to any service. Cloud destinations are separate.
export type SaveRoute = 'picker' | 'share' | 'download';

const pad = (n: number) => String(n).padStart(2, '0');
export function backupFileName(prefix: string, now: Date, ext: 'tbx' = 'tbx'): string {
  const d = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `tillbox-backup-${prefix.replace(/[^A-Za-z0-9]/g, '')}-${d}.${ext}`;
}

export interface FileEnv {
  showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(b: BlobPart): Promise<void>; close(): Promise<void> }> }>;
  navigator?: { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> };
  document?: Document;
  URL?: typeof URL;
}

export class SaveCancelled extends Error { constructor() { super('save cancelled'); this.name = 'SaveCancelled'; } }

export async function saveToDevice(bytes: Uint8Array, name: string, opts: { prefer?: SaveRoute; env?: FileEnv } = {}): Promise<SaveRoute> {
  const env: FileEnv = opts.env ?? (globalThis as unknown as FileEnv);
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const order: SaveRoute[] = opts.prefer ? [opts.prefer] : ['picker', 'share', 'download'];
  for (const route of order) {
    if (route === 'picker' && env.showSaveFilePicker) {
      try {
        const h = await env.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Tillbox backup', accept: { 'application/octet-stream': ['.tbx'] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return 'picker';
      } catch (e) { if ((e as Error).name === 'AbortError') throw new SaveCancelled(); if (opts.prefer) throw e; }
    }
    if (route === 'share' && env.navigator?.share && env.navigator.canShare) {
      const file = new File([blob], name, { type: 'application/octet-stream' });
      if (env.navigator.canShare({ files: [file] })) {
        try { await env.navigator.share({ files: [file], title: name }); return 'share'; }
        catch (e) { if ((e as Error).name === 'AbortError') throw new SaveCancelled(); if (opts.prefer) throw e; }
      }
    }
    if (route === 'download' && env.document && env.URL) {
      const url = env.URL.createObjectURL(blob);
      const a = env.document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
      env.document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => env.URL!.revokeObjectURL(url), 30_000);
      return 'download';
    }
  }
  throw new Error('this browser cannot save files');
}
