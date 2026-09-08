import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Express } from 'express';

interface TestServerOptions {
  adminUsername?: string;
  adminPassword?: string;
}

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

// Démarre une instance de l'app sur un port éphémère, avec une base SQLite
// temporaire et des identifiants admin connus, isolée des autres tests.
export async function startTestServer(
  { adminUsername = 'admin', adminPassword = 'test-password' }: TestServerOptions = {}
): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'stock-manager-test-'));
  process.env.DB_PATH = join(dir, 'stock.db');
  process.env.JWT_SECRET = 'test-secret';
  process.env.ADMIN_USERNAME = adminUsername;
  process.env.ADMIN_PASSWORD = adminPassword;

  // Import dynamique après avoir positionné les variables d'environnement,
  // et avec un cache-buster pour obtenir une instance fraîche de la base à chaque appel.
  const mod: { app: Express } = await import(`../index.ts?test=${Date.now()}-${Math.random()}`);
  const server = mod.app.listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://localhost:${port}/api`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
