import { openDbOrExplain, migrate } from './db.js';
import { buildApp, loadConfig } from './app.js';
import { PRODUCT_NAME } from '../shared/brand.js';

const config = loadConfig();
let db;
try { db = openDbOrExplain(config.dbPath); migrate(db); } catch (e) { console.error(`\n${e.message}\n`); process.exit(1); }
const app = await buildApp({ db, config, logger: true });
await app.listen({ port: config.port, host: config.host });
console.log(`${PRODUCT_NAME} listening on ${config.host}:${config.port}, public address ${config.publicUrl}  (run "npm run seed" first for demo data)`);
