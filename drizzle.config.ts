import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile('server/.env');
} catch {
  // Pas de fichier .env — DATABASE_URL doit être défini autrement.
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/stock_manager',
  },
});
