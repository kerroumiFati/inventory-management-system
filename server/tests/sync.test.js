import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

describe('sync push/pull', () => {
  let server;
  let token;

  before(async () => {
    server = await startTestServer({ adminUsername: 'admin', adminPassword: 'test-password' });
    const login = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test-password' }),
    });
    ({ token } = await login.json());
  });

  after(async () => {
    if (server) await server.close();
  });

  test('push puis pull renvoie les mêmes données', async () => {
    const payload = {
      products: [{ id: 1, name: 'Vis', reference: 'V-1', unit: 'pièce', stockInitial: 50 }],
      movements: [{ id: 1, productId: 1, type: 'sortie', date: '2026-01-01', quantity: 10 }],
      bons: [{ id: 1, number: 'STK-2026-0001', date: '2026-01-01', type: 'sortie' }],
      bonItems: [{ id: 1, bonId: 1, productId: 1, quantity: 10 }],
    };

    const push = await fetch(`${server.baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    assert.equal(push.status, 200);
    const pushBody = await push.json();
    assert.deepEqual(pushBody.synced, { products: 1, movements: 1, bons: 1 });

    const pull = await fetch(`${server.baseUrl}/sync/pull`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(pull.status, 200);
    const pulled = await pull.json();

    assert.equal(pulled.products.length, 1);
    assert.equal(pulled.products[0].name, 'Vis');
    assert.equal(pulled.movements.length, 1);
    assert.equal(pulled.bons[0].number, 'STK-2026-0001');
    assert.equal(pulled.bonItems.length, 1);
  });

  test('un push suivant remplace entièrement les données précédentes', async () => {
    const second = {
      products: [{ id: 2, name: 'Écrou' }],
      movements: [],
      bons: [],
      bonItems: [],
    };

    await fetch(`${server.baseUrl}/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(second),
    });

    const pull = await fetch(`${server.baseUrl}/sync/pull`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pulled = await pull.json();

    assert.equal(pulled.products.length, 1);
    assert.equal(pulled.products[0].name, 'Écrou');
    assert.equal(pulled.movements.length, 0);
  });
});
