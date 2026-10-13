import { openDbOrExplain, migrate } from './db.js';
import { buildApp, loadConfig } from './app.js';
import { PRODUCT_NAME } from '../shared/brand.js';

const config = loadConfig();
let db;
try { db = openDbOrExplain(config.dbPath); migrate(db); } catch (e) { console.error(`\n${e.message}\n`); process.exit(1); }
const app = await buildApp({ db, config, logger: true });
await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`${PRODUCT_NAME} running at http://127.0.0.1:${config.port}  (run "npm run seed" first for demo data)`);
