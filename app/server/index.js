import { openDb, migrate } from './db.js';
import { buildApp, loadConfig } from './app.js';
import { PRODUCT_NAME } from '../shared/brand.js';

const config = loadConfig();
const db = openDb(config.dbPath);
migrate(db);
const app = await buildApp({ db, config, logger: true });
await app.listen({ port: config.port, host: '127.0.0.1' });
console.log(`${PRODUCT_NAME} running at http://127.0.0.1:${config.port}  (run "npm run seed" first for demo data)`);
