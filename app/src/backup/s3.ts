// S3-compatible storage (AWS S3, MinIO, Backblaze B2, Wasabi, a NAS...). AWS Signature Version 4 with WebCrypto only,
// so it runs in the browser and in Node. Path-style URLs: https://host/bucket/key.
// The bucket must allow cross-origin requests from the app (CORS) when used from a browser tablet. In server modes the
// server does the upload and no key lives on a device.
export interface S3Config { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix?: string }
type F = typeof fetch;

const enc = new TextEncoder();
const hex = (u: ArrayBuffer | Uint8Array) => [...new Uint8Array(u as ArrayBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async (data: Uint8Array | string) => hex(await crypto.subtle.digest('SHA-256', (typeof data === 'string' ? enc.encode(data) : data) as BufferSource));
async function hmac(key: Uint8Array | ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export interface SignInput {
  method: string; host: string; path: string; query?: Record<string, string>;
  headers?: Record<string, string>;      // extra headers to sign (lower-case names)
  payloadHash: string; region: string; service?: string; accessKeyId: string; secretAccessKey: string;
  amzDate: string;                       // 20260615T000000Z
}
/** Exposed for tests: the canonical request and the Authorization header for a request. */
export async function signV4(i: SignInput): Promise<{ authorization: string; canonicalRequest: string; signature: string }> {
  const service = i.service ?? 's3';
  const day = i.amzDate.slice(0, 8);
  const all: Record<string, string> = { host: i.host, 'x-amz-content-sha256': i.payloadHash, 'x-amz-date': i.amzDate, ...(i.headers ?? {}) };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri = i.path.split('/').map((seg) => uriEncode(decodeURIComponent(seg))).join('/') || '/';
  const canonicalQuery = Object.entries(i.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');
  const canonicalRequest = [i.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, i.payloadHash].join('\n');
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  let k: ArrayBuffer = await hmac(enc.encode('AWS4' + i.secretAccessKey), day);
  for (const part of [i.region, service, 'aws4_request']) k = await hmac(k, part);
  const signature = hex(await hmac(k, toSign));
  return { authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, canonicalRequest, signature };
}

const amz = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export class S3Error extends Error { constructor(public status: number, public code: string, detail: string) { super(`S3 ${status} ${code}: ${detail}`); this.name = 'S3Error'; } }

async function request(cfg: S3Config, method: string, key: string, opts: { body?: Uint8Array; query?: Record<string, string>; fetch?: F; now?: () => Date } = {}): Promise<Response> {
  const url = new URL(cfg.endpoint.replace(/\/$/, ''));
  const path = `${url.pathname.replace(/\/$/, '')}/${cfg.bucket}${key ? '/' + key.split('/').map(encodeURIComponent).join('/') : ''}`;
  const body = opts.body, payloadHash = await sha256Hex(body ?? new Uint8Array());
  const amzDate = amz((opts.now ?? (() => new Date()))());
  const { authorization } = await signV4({ method, host: url.host, path, query: opts.query, payloadHash, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, amzDate });
  const qs = opts.query ? '?' + Object.entries(opts.query).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&') : '';
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const res = await f(`${url.origin}${path}${qs}`, { method, body: body as BodyInit | undefined, headers: { 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, authorization } });
  if (!res.ok && !(method === 'HEAD' && res.status === 404)) {
    const text = await res.text().catch(() => '');
    throw new S3Error(res.status, /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? 'Error', /<Message>([^<]*)<\/Message>/.exec(text)?.[1] ?? text.slice(0, 120));
  }
  return res;
}

export const objectKey = (cfg: S3Config, name: string) => `${(cfg.prefix ?? '').replace(/^\/|\/$/g, '')}${cfg.prefix ? '/' : ''}${name}`;

/** Upload, then read it back and compare a SHA-256: a backup only counts as stored once the copy matches. */
export async function putVerified(cfg: S3Config, name: string, bytes: Uint8Array, over: { fetch?: F; now?: () => Date } = {}): Promise<{ key: string; bytes: number; sha256: string }> {
  const key = objectKey(cfg, name);
  await request(cfg, 'PUT', key, { body: bytes, ...over });
  const back = new Uint8Array(await (await request(cfg, 'GET', key, over)).arrayBuffer());
  const [a, b] = [await sha256Hex(bytes), await sha256Hex(back)];
  if (a !== b) throw new Error('uploaded backup does not match what was sent');
  return { key, bytes: bytes.length, sha256: a };
}
export async function getObject(cfg: S3Config, key: string, over: { fetch?: F; now?: () => Date } = {}): Promise<Uint8Array> {
  return new Uint8Array(await (await request(cfg, 'GET', key, over)).arrayBuffer());
}
/** Newest first. Used to choose which backup to restore. */
export async function listBackups(cfg: S3Config, over: { fetch?: F; now?: () => Date } = {}): Promise<{ key: string; size: number; modified: string }[]> {
  const prefix = (cfg.prefix ?? '').replace(/^\/|\/$/g, '');
  const res = await request(cfg, 'GET', '', { query: { 'list-type': '2', ...(prefix ? { prefix: prefix + '/' } : {}) }, ...over });
  const xml = await res.text();
  return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    key: /<Key>([^<]+)<\/Key>/.exec(m[1])![1], size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])![1]), modified: /<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] ?? '',
  })).sort((a, b) => (a.modified < b.modified ? 1 : -1));
}
