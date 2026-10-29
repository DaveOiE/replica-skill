// A minimal S3 endpoint that VERIFIES AWS Signature V4 using Node's own crypto, written separately from the signer
// under test (src/backup/s3.ts uses WebCrypto). Supports PUT, GET, HEAD and ListObjectsV2 for one bucket.
import { createServer, type Server } from 'node:http';
import { createHash, createHmac } from 'node:crypto';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hm = (k: Buffer | string, m: string) => createHmac('sha256', k).update(m).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export interface FakeS3 { url: string; port: number; objects: Map<string, Buffer>; close(): Promise<void>; rejected: string[] }

export async function startFakeS3(opts: { bucket: string; accessKeyId: string; secretAccessKey: string; region: string }): Promise<FakeS3> {
  const objects = new Map<string, Buffer>(); const rejected: string[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PUT, HEAD, OPTIONS', 'access-control-expose-headers': 'etag' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      const fail = (status: number, code: string, why: string) => { rejected.push(`${code}: ${why}`); res.writeHead(status, { 'content-type': 'application/xml', ...cors }); res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${why}</Message></Error>`); };
      const url = new URL(req.url ?? '/', 'http://x');
      const auth = req.headers.authorization ?? '';
      const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
      if (!m) return fail(403, 'AccessDenied', 'missing or malformed Authorization');
      const [, keyId, day, region, signedHeaders, signature] = m;
      if (keyId !== opts.accessKeyId) return fail(403, 'InvalidAccessKeyId', 'unknown access key');
      if (region !== opts.region) return fail(403, 'AuthorizationHeaderMalformed', 'wrong region');
      const amzDate = String(req.headers['x-amz-date'] ?? '');
      if (Math.abs(Date.now() - Date.parse(amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'))) > 15 * 60_000) return fail(403, 'RequestTimeTooSkewed', 'clock');
      const claimed = String(req.headers['x-amz-content-sha256'] ?? '');
      if (claimed !== sha(body)) return fail(400, 'XAmzContentSHA256Mismatch', 'body does not match x-amz-content-sha256');
      const names = signedHeaders.split(';');
      const canonHeaders = names.map((n) => `${n}:${String(req.headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
      const canonQuery = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
      const canonUri = url.pathname.split('/').map((s) => enc(decodeURIComponent(s))).join('/');
      const canonical = [req.method, canonUri, canonQuery, canonHeaders, signedHeaders, claimed].join('\n');
      const toSign = ['AWS4-HMAC-SHA256', amzDate, `${day}/${region}/s3/aws4_request`, sha(canonical)].join('\n');
      const expected = hm(hm(hm(hm('AWS4' + opts.secretAccessKey, day), region), 's3'), 'aws4_request');
      if (createHmac('sha256', expected).update(toSign).digest('hex') !== signature) return fail(403, 'SignatureDoesNotMatch', 'signature mismatch');

      const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
      if (parts[0] !== opts.bucket) return fail(404, 'NoSuchBucket', 'no such bucket');
      const key = parts.slice(1).join('/');
      if (req.method === 'PUT') { objects.set(key, body); res.writeHead(200, { etag: `"${sha(body).slice(0, 32)}"`, ...cors }); return res.end(); }
      if (req.method === 'GET' && !key) {
        const prefix = url.searchParams.get('prefix') ?? '';
        const xml = [...objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>2026-06-15T00:00:00.000Z</LastModified><Size>${v.length}</Size></Contents>`).join('');
        res.writeHead(200, { 'content-type': 'application/xml', ...cors }); return res.end(`<?xml version="1.0"?><ListBucketResult>${xml}</ListBucketResult>`);
      }
      const obj = objects.get(key);
      if (!obj) return fail(404, 'NoSuchKey', 'no such key');
      if (req.method === 'GET') { res.writeHead(200, { 'content-length': obj.length, ...cors }); return res.end(obj); }
      if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': obj.length, ...cors }); return res.end(); }
      return fail(405, 'MethodNotAllowed', 'unsupported');
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, port, objects, rejected, close: () => new Promise((ok) => server.close(() => ok())) };
}
