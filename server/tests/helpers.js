import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Démarre une instance de l'app sur un port éphémère, avec une base SQLite
// temporaire et des identifiants admin connus, isolée des autres tests.
export async function startTestServer({ adminUsername = 'admin', adminPassword = 'test-password' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stock-manager-test-'));
  process.env.DB_PATH = join(dir, 'stock.db');
  process.env.JWT_SECRET = 'test-secret';
  process.env.ADMIN_USERNAME = adminUsername;
  process.env.ADMIN_PASSWORD = adminPassword;

  // Import dynamique après avoir positionné les variables d'environnement,
  // et avec un cache-buster pour obtenir une instance fraîche de la base à chaque appel.
  const mod = await import(`../index.js?test=${Date.now()}-${Math.random()}`);
  const server = mod.app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  return {
    baseUrl: `http://localhost:${port}/api`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
