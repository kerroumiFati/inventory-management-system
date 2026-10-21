import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Express } from 'express';

interface TestServerOptions {
  adminUsername?: string;
  adminPassword?: string;
  // Prépare le fichier SQLite avant le démarrage du serveur (ex. tester une migration).
  setupDb?: (dbPath: string) => void;
}

export interface TestServer {
  baseUrl: string;
  // Connexion avec le compte admin ; renvoie le jeton.
  login: (username?: string, password?: string) => Promise<string>;
  close: () => Promise<void>;
}

// Démarre une instance de l'app sur un port éphémère, avec une base SQLite
// temporaire et des identifiants admin connus, isolée des autres tests.
export async function startTestServer(
  { adminUsername = 'admin', adminPassword = 'test-password', setupDb }: TestServerOptions = {}
): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'stock-manager-test-'));
  process.env.DB_PATH = join(dir, 'stock.db');
  setupDb?.(process.env.DB_PATH);
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

  const baseUrl = `http://localhost:${port}/api`;
  return {
    baseUrl,
    login: async (username = adminUsername, password = adminPassword) => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      return body.token;
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
