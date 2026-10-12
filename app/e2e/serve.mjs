// Starts the app on port 4010 with an in-memory database of fake data, for the browser tests.
// The generated fake passwords go to .local/e2e-credentials.json (gitignored), never into the repo.
import { writeFileSync, mkdirSync } from 'node:fs';
import { freshDb } from '../tests/helpers.js';
import { buildApp } from '../server/app.js';

const { db, creds } = freshDb();
mkdirSync('.local', { recursive: true });
writeFileSync('.local/e2e-credentials.json', JSON.stringify(creds), { mode: 0o600 });
const app = await buildApp({ db });
await app.listen({ port: 4010, host: '127.0.0.1' });
console.log('e2e server ready on 4010');
