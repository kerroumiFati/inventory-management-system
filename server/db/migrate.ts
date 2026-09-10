import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // Pas de fichier .env — DATABASE_URL doit être défini autrement.
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('  ✗ DATABASE_URL est requis pour appliquer les migrations (voir server/.env.example)');
  process.exit(1);
}

const { db, pool } = createDb(connectionString);

console.log('  → Application des migrations...');
await migrate(db, { migrationsFolder: join(__dirname, 'migrations') });
console.log('  ✓ Migrations appliquées');

await pool.end();
