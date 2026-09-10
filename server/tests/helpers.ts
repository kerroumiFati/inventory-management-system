import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import type { Pool } from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../db/client.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestServerOptions {
  adminUsername?: string;
  adminPassword?: string;
}

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

const PG_PORT = 5434;
const PG_USER = 'postgres';
const PG_PASSWORD = 'postgres';

// Démarre une instance de l'app sur un port éphémère, avec un cluster PostgreSQL
// embarqué dédié (créé et arrêté pour cet appel) et des identifiants admin
// connus, isolée des autres tests. Le cluster est explicitement arrêté dans
// `close()` — indispensable, sinon le processus `postgres` embarqué reste actif
// et empêche le runner de tests de se terminer.
export async function startTestServer(
  { adminUsername = 'admin', adminPassword = 'test-password' }: TestServerOptions = {}
): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'stock-manager-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('stock_manager_test');

  const connectionString = `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/stock_manager_test`;

  const migrationClient = createDb(connectionString);
  await migrate(migrationClient.db, { migrationsFolder: join(__dirname, '..', 'db', 'migrations') });
  await migrationClient.pool.end();

  process.env.DATABASE_URL = connectionString;
  process.env.JWT_SECRET = 'test-secret';
  process.env.ADMIN_USERNAME = adminUsername;
  process.env.ADMIN_PASSWORD = adminPassword;

  // Import dynamique après avoir positionné les variables d'environnement,
  // et avec un cache-buster pour obtenir une instance fraîche à chaque appel.
  const mod: { app: Express; pool: Pool } = await import(`../index.ts?test=${Date.now()}-${Math.random()}`);
  const server = mod.app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://localhost:${port}/api`,
    close: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await mod.pool.end();
      await pg.stop();
    },
  };
}
