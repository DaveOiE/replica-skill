import { Pool } from 'pg';
import { startSyncServer } from '../server/index';
const admin = new Pool({ connectionString: process.env.TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5499/postgres' });
await admin.query('DROP DATABASE IF EXISTS tillbox_e2e WITH (FORCE)');
await admin.query('CREATE DATABASE tillbox_e2e');
await admin.end();
const s = await startSyncServer({ databaseUrl: (process.env.TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5499/postgres').replace(/\/[^/]*$/, '/tillbox_e2e'), adminToken: 'e2e-admin-token-0123456789abcdef', host: '127.0.0.1', port: 4100 });
console.log('e2e sync server on', s.port);
