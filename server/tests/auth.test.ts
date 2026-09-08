import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, type TestServer } from './helpers.ts';

describe('authentication', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer({ adminUsername: 'admin', adminPassword: 'test-password' });
  });

  after(async () => {
    if (server) await server.close();
  });

  test('login réussi avec les bons identifiants renvoie un token', async () => {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.username, 'admin');
    assert.equal(body.role, 'admin');
    assert.ok(body.token);
  });

  test('login refusé avec un mauvais mot de passe', async () => {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    assert.equal(res.status, 401);
  });

  test('une route protégée refuse l\'accès sans token', async () => {
    const res = await fetch(`${server.baseUrl}/sync/pull`);
    assert.equal(res.status, 401);
  });

  test('une route protégée accepte un token valide', async () => {
    const login = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password' }),
    });
    const { token } = await login.json();

    const res = await fetch(`${server.baseUrl}/sync/pull`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
  });
});
