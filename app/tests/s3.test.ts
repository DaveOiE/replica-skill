import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import S3rver from 's3rver';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signV4, sha256Hex, putVerified, listBackups, getObject, objectKey, S3Error, type S3Config } from '../src/backup/s3';
import { backupToS3 } from '../src/services/backups';
import { createSimpleProduct } from '../src/services/catalogue';
import { restorePhysicalBackup, fingerprint } from '../src/backup/backup';
import { fromPglite } from '../src/db/pglite';
import { makeDevice } from './helpers';
import { startFakeS3, type FakeS3 } from './fakeS3';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('AWS Signature Version 4', () => {
  it('matches the worked example in AWS\'s own documentation (GET Object with a Range header)', async () => {
    const r = await signV4({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY, region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', amzDate: '20130524T000000Z',
    });
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(r.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('matches the documented example with query parameters (list objects)', async () => {
    const r = await signV4({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/', query: { 'max-keys': '2', prefix: 'J' },
      payloadHash: EMPTY, region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', amzDate: '20130524T000000Z',
    });
    expect(r.signature).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
  it('sha256 of nothing is the well-known constant', async () => { expect(await sha256Hex('')).toBe(EMPTY); });
  it('keys with awkward characters are encoded the S3 way', () => {
    expect(objectKey({ prefix: 'shop/one/' } as S3Config, 'a b.tbx')).toBe('shop/one/a b.tbx');
    expect(objectKey({} as S3Config, 'x.tbx')).toBe('x.tbx');
  });
});

// s3rver is a third-party implementation of the S3 API. It does NOT verify v4 signatures (its source says so), so these
// tests prove the request shapes and XML parsing against another implementation, not signature correctness.
describe('against a third-party S3 implementation (s3rver)', () => {
  let server: any; let dir: string; let cfg: S3Config;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 's3-'));
    const port = 4600 + Math.floor(Math.random() * 300);
    server = new S3rver({ port, address: '127.0.0.1', silent: true, directory: dir, configureBuckets: [{ name: 'backups', configs: [] }] });
    await server.run();
    cfg = { endpoint: `http://127.0.0.1:${port}`, region: 'us-east-1', bucket: 'backups', accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER', prefix: 'shop-1' };
  });
  afterAll(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });

  it('uploads, reads back and compares; the object is exactly what was sent', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31 + 7) % 256);
    const r = await putVerified(cfg, 'one.tbx', bytes);
    expect(r).toMatchObject({ key: 'shop-1/one.tbx', bytes: 70_000 });
    expect(await sha256Hex(await getObject(cfg, r.key))).toBe(r.sha256);
  });
  it('lists backups under the prefix, newest first', async () => {
    await putVerified(cfg, 'two.tbx', new Uint8Array([1, 2, 3]));
    const list = await listBackups(cfg);
    expect(list.map((o) => o.key).sort()).toEqual(['shop-1/one.tbx', 'shop-1/two.tbx']);
    expect(list.every((o) => o.size > 0)).toBe(true);
  });
  it('a missing bucket and a wrong key give clear errors', async () => {
    await expect(putVerified({ ...cfg, bucket: 'nope' }, 'x.tbx', new Uint8Array([1]))).rejects.toBeInstanceOf(S3Error);
    await expect(getObject(cfg, 'shop-1/does-not-exist.tbx')).rejects.toMatchObject({ status: 404 });
  });
  it('a clock that is badly wrong is reported as such', async () => {
    await expect(putVerified(cfg, 'x.tbx', new Uint8Array([1]), { now: () => new Date('2020-01-01T00:00:00Z') })).rejects.toMatchObject({ code: 'RequestTimeTooSkewed' });
  });
  it('catches a store that returns something different from what was uploaded', async () => {
    const liar: typeof fetch = async (url, init) => {
      const res = await fetch(url, init);
      return (init?.method === 'GET' && !String(url).includes('list-type')) ? new Response(new Uint8Array([9, 9, 9]), { status: 200 }) : res;
    };
    await expect(putVerified(cfg, 'liar.tbx', new Uint8Array([1, 2, 3, 4]), { fetch: liar })).rejects.toThrow('does not match what was sent');
  });

  it('end to end: a whole shop is backed up to S3-compatible storage, fetched back, decrypted and restored', async () => {
    const d = await makeDevice('s3-shop', { seed: true });
    await createSimpleProduct(d.ctx, { sku: 'S3', name: 'Backed up', priceCents: 100, openingStock: 9, taxGroupId: null });
    const before = await fingerprint(d.db);
    const r = await backupToS3(d.ctx, d.pg, { passphrase: 'a long passphrase here', s3: cfg, iterations: 5000 });
    expect(r.key).toMatch(/^shop-1\/tillbox-backup-.*\.tbx$/);
    const [run] = await d.db.query<any>("SELECT destination, status, verified FROM backup_runs");
    expect(run).toEqual({ destination: 's3', status: 'ok', verified: true });
    const restored = await restorePhysicalBackup(await getObject(cfg, r.key), 'a long passphrase here');
    expect(await fingerprint(fromPglite(restored))).toEqual(before);
    await restored.close();
  });
});

describe('against a server that verifies every signature independently', () => {
  let s3: FakeS3; let cfg: S3Config;
  beforeAll(async () => {
    s3 = await startFakeS3({ bucket: 'bk', accessKeyId: 'AKIATEST', secretAccessKey: 'sekret/key+value', region: 'ap-southeast-2' });
    cfg = { endpoint: s3.url, region: 'ap-southeast-2', bucket: 'bk', accessKeyId: 'AKIATEST', secretAccessKey: 'sekret/key+value', prefix: 'my shop/2026' };
  });
  afterAll(async () => { await s3.close(); });

  it('every request we make is accepted: upload, read back, list (a prefix with a space, in an Australian region)', async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 17) % 251);
    const r = await putVerified(cfg, 'tillbox backup 1.tbx', bytes);
    expect(r.key).toBe('my shop/2026/tillbox backup 1.tbx');
    expect(s3.objects.get('my shop/2026/tillbox backup 1.tbx')!.length).toBe(200_000);
    expect((await listBackups(cfg)).map((o) => o.key)).toEqual(['my shop/2026/tillbox backup 1.tbx']);
    expect(s3.rejected).toEqual([]);
  });
  it('a wrong secret, a wrong key id and a wrong region are each refused by the server', async () => {
    await expect(putVerified({ ...cfg, secretAccessKey: 'not-the-secret' }, 'x.tbx', new Uint8Array([1]))).rejects.toMatchObject({ status: 403, code: 'SignatureDoesNotMatch' });
    await expect(putVerified({ ...cfg, accessKeyId: 'AKIAOTHER' }, 'x.tbx', new Uint8Array([1]))).rejects.toMatchObject({ code: 'InvalidAccessKeyId' });
    await expect(putVerified({ ...cfg, region: 'us-east-1' }, 'x.tbx', new Uint8Array([1]))).rejects.toMatchObject({ code: 'AuthorizationHeaderMalformed' });
  });
  it('a request altered after signing is refused (the body hash is checked)', async () => {
    const tamper: typeof fetch = async (url, init) => fetch(url, { ...init, body: init?.method === 'PUT' ? new Uint8Array([6, 6, 6]) : init?.body });
    await expect(putVerified(cfg, 'tamper.tbx', new Uint8Array([1, 2, 3]), { fetch: tamper })).rejects.toMatchObject({ code: 'XAmzContentSHA256Mismatch' });
    expect(s3.objects.has('my shop/2026/tamper.tbx')).toBe(false);
  });
  it('a clock that is badly wrong is reported as such', async () => {
    await expect(putVerified(cfg, 'x.tbx', new Uint8Array([1]), { now: () => new Date('2020-01-01T00:00:00Z') })).rejects.toMatchObject({ code: 'RequestTimeTooSkewed' });
  });
  it('end to end: a shop is backed up (encrypted, verified), fetched back and restored; the bucket never holds plaintext', async () => {
    const d = await makeDevice('s3-shop', { seed: true });
    await createSimpleProduct(d.ctx, { sku: 'S3', name: 'Backed up PLAINTEXT-MARKER', priceCents: 100, openingStock: 9, taxGroupId: null });
    const before = await fingerprint(d.db);
    const r = await backupToS3(d.ctx, d.pg, { passphrase: 'a long passphrase here', s3: cfg, iterations: 5000 });
    expect(r.key).toMatch(/^my shop\/2026\/tillbox-backup-.*\.tbx$/);
    expect(Buffer.from(s3.objects.get(r.key)!).includes('PLAINTEXT-MARKER')).toBe(false);
    expect(await d.db.query<any>('SELECT destination, status, verified FROM backup_runs')).toEqual([{ destination: 's3', status: 'ok', verified: true }]);
    const restored = await restorePhysicalBackup(await getObject(cfg, r.key), 'a long passphrase here');
    expect(await fingerprint(fromPglite(restored))).toEqual(before);
    await restored.close();
  });
  it('a failed upload is recorded as a failure and never as a good backup', async () => {
    const d = await makeDevice('s3-fail', { seed: true });
    await expect(backupToS3(d.ctx, d.pg, { passphrase: 'a long passphrase here', s3: { ...cfg, secretAccessKey: 'wrong' }, iterations: 5000 })).rejects.toBeInstanceOf(S3Error);
    expect(await d.db.query<any>('SELECT status, verified FROM backup_runs')).toEqual([{ status: 'failed', verified: false }]);
  });
});
