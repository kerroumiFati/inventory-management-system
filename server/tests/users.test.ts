import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './helpers.ts';

describe('gestion des utilisateurs et sécurité', () => {
  let server: TestServer;
  let adminToken: string;

  const call = (path: string, token: string, method = 'GET', body?: unknown) => fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  before(async () => {
    server = await startTestServer();
    adminToken = await server.login();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('un admin crée un utilisateur qui peut ensuite se connecter', async () => {
    const res = await call('/users', adminToken, 'POST', { username: 'magasin', password: 'motdepasse1', role: 'user' });
    assert.equal(res.status, 201);
    const token = await server.login('magasin', 'motdepasse1');
    assert.ok(token);
  });

  test('identifiant en double refusé', async () => {
    const res = await call('/users', adminToken, 'POST', { username: 'magasin', password: 'motdepasse1' });
    assert.equal(res.status, 409);
  });

  test('mot de passe trop court refusé (8 caractères minimum)', async () => {
    const res = await call('/users', adminToken, 'POST', { username: 'court', password: '1234' });
    assert.equal(res.status, 400);
  });

  test('un simple utilisateur n\'accède pas à la gestion des comptes', async () => {
    const token = await server.login('magasin', 'motdepasse1');
    const res = await call('/users', token);
    assert.equal(res.status, 403);
  });

  test('un compte supprimé perd l\'accès immédiatement, même avec un jeton valide', async () => {
    await call('/users', adminToken, 'POST', { username: 'temp', password: 'motdepasse1' });
    const token = await server.login('temp', 'motdepasse1');
    const list = await (await call('/users', adminToken)).json() as { id: number; username: string }[];
    const temp = list.find(u => u.username === 'temp')!;
    assert.equal((await call(`/users/${temp.id}`, adminToken, 'DELETE')).status, 200);
    assert.equal((await call('/sync/pull', token)).status, 401);
  });

  test('impossible de retirer le dernier administrateur', async () => {
    const list = await (await call('/users', adminToken)).json() as { id: number; username: string }[];
    const admin = list.find(u => u.username === 'admin')!;
    const res = await call(`/users/${admin.id}`, adminToken, 'PATCH', { role: 'user' });
    assert.equal(res.status, 400);
    assert.equal((await call(`/users/${admin.id}`, adminToken, 'DELETE')).status, 400, 'ni de supprimer son propre compte');
  });

  test('réinitialisation du mot de passe par un admin', async () => {
    const list = await (await call('/users', adminToken)).json() as { id: number; username: string }[];
    const u = list.find(x => x.username === 'magasin')!;
    assert.equal((await call(`/users/${u.id}`, adminToken, 'PATCH', { password: 'nouveaumdp' })).status, 200);
    assert.ok(await server.login('magasin', 'nouveaumdp'));
  });

  test('connexion bloquée après 5 échecs', async () => {
    const attempt = () => fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'magasin', password: 'faux' }),
    });
    for (let i = 0; i < 5; i++) assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
    // Même le bon mot de passe est refusé pendant le blocage.
    await assert.rejects(server.login('magasin', 'nouveaumdp'), /Trop de tentatives/);
  });
});
