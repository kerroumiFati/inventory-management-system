import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { startTestServer, type TestServer } from './helpers.ts';

const product = (uid: string, updatedAt: string, extra: Record<string, unknown> = {}) =>
  ({ uid, updatedAt, name: `Produit ${uid}`, unit: 'pièce', stockInitial: 10, ...extra });

describe('sync push/pull (fusion par uid)', () => {
  let server: TestServer;
  let token: string;

  const push = (body: Record<string, unknown>) => fetch(`${server.baseUrl}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ clientId: 'poste-A', ...body }),
  });
  const pull = async (since = 0, clientId = 'poste-B') => {
    const res = await fetch(`${server.baseUrl}/sync/pull?since=${since}&clientId=${clientId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    return res.json();
  };

  before(async () => {
    server = await startTestServer();
    token = await server.login();
  });

  after(async () => {
    if (server) await server.close();
  });

  test('push puis pull renvoie les mêmes données, relations par uid', async () => {
    const res = await push({
      products: [product('p1', '2026-01-01T00:00:00.000Z')],
      bons: [{ uid: 'b1', updatedAt: '2026-01-01T00:00:00.000Z', number: 'STK-2026-0001', date: '2026-01-01', isFormal: false }],
      movements: [{ uid: 'm1', updatedAt: '2026-01-01T00:00:00.000Z', productUid: 'p1', bonUid: 'b1', type: 'sortie', date: '2026-01-01', quantity: 3 }],
      bonItems: [{ uid: 'i1', updatedAt: '2026-01-01T00:00:00.000Z', productUid: 'p1', bonUid: 'b1', quantity: 3 }],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.applied, 4);

    const data = await pull();
    assert.equal(data.full, true);
    assert.equal(data.products[0].uid, 'p1');
    assert.equal(data.movements[0].productUid, 'p1');
    assert.equal(data.movements[0].bonUid, 'b1');
    assert.equal(data.bons[0].isFormal, false);
    assert.equal(data.products[0].id, undefined, 'les id locaux ne transitent pas');
  });

  test('un push ne touche pas aux lignes non envoyées (pas de remplacement complet)', async () => {
    await push({ products: [product('p2', '2026-01-02T00:00:00.000Z')] });
    const data = await pull();
    assert.deepEqual(data.products.map((p: { uid: string }) => p.uid).sort(), ['p1', 'p2']);
  });

  test('la modification la plus récente l\'emporte', async () => {
    await push({ products: [product('p3', '2026-02-01T00:00:00.000Z', { name: 'récent' })] });
    const res = await push({ products: [product('p3', '2026-01-15T00:00:00.000Z', { name: 'ancien' })] });
    assert.equal((await res.json()).stale, 1);
    const data = await pull();
    assert.equal(data.products.find((p: { uid: string }) => p.uid === 'p3').name, 'récent');
  });

  test('pull incrémental : seulement les changements depuis la révision, hors ceux du poste demandeur', async () => {
    const { revision } = await pull();
    await push({ clientId: 'poste-A', products: [product('p4', '2026-03-01T00:00:00.000Z')] });

    const forB = await pull(revision, 'poste-B');
    assert.equal(forB.full, false);
    assert.deepEqual(forB.products.map((p: { uid: string }) => p.uid), ['p4']);

    const forA = await pull(revision, 'poste-A');
    assert.equal(forA.products.length, 0, 'le poste A a déjà sa propre modification');
  });

  test('les suppressions sont propagées, et vident les données', async () => {
    const { revision } = await pull();
    await push({ deletions: [{ tbl: 'products', uid: 'p4', deletedAt: '2026-03-02T00:00:00.000Z' }] });
    const inc = await pull(revision);
    assert.deepEqual(inc.deletions, [{ tbl: 'products', uid: 'p4', deletedAt: '2026-03-02T00:00:00.000Z' }]);
    const full = await pull();
    assert.ok(!full.products.some((p: { uid: string }) => p.uid === 'p4'));
  });

  test('une modification postérieure à la suppression l\'emporte (ligne ressuscitée)', async () => {
    await push({ deletions: [{ tbl: 'products', uid: 'p2', deletedAt: '2026-01-03T00:00:00.000Z' }] });
    await push({ products: [product('p2', '2026-01-04T00:00:00.000Z', { name: 'revenu' })] });
    const data = await pull();
    assert.equal(data.products.find((p: { uid: string }) => p.uid === 'p2')?.name, 'revenu');
  });

  test('traçabilité : une nouvelle saisie sans auteur est attribuée au compte qui l\'envoie', async () => {
    const mvt = (uid: string, extra: Record<string, unknown> = {}) =>
      ({ uid, updatedAt: '2026-05-01T00:00:00.000Z', productUid: 'p1', type: 'sortie', date: '2026-05-01', quantity: 1, ...extra });
    await push({ movements: [mvt('m-anonyme'), mvt('m-bob', { createdBy: 'bob' })] });
    const data = await pull();
    const by = (uid: string) => data.movements.find((m: { uid: string }) => m.uid === uid)?.createdBy;
    assert.equal(by('m-anonyme'), 'admin');
    assert.equal(by('m-bob'), 'bob', 'l\'auteur fourni par le poste est conservé');
  });

  test('les nouveaux champs (prix, fournisseur, commande, inventaire) font l\'aller-retour', async () => {
    await push({
      products: [product('p-prix', '2026-05-02T00:00:00.000Z', { unitPrice: 3.5, supplier: 'Fournisseur X', maxStock: 40 })],
      bons: [{ uid: 'b-rec', updatedAt: '2026-05-02T00:00:00.000Z', number: 'REC-2026-0001', date: '2026-05-02', type: 'entree', orderUid: 'b-cmd' }],
      bonItems: [{ uid: 'i-inv', updatedAt: '2026-05-02T00:00:00.000Z', productUid: 'p-prix', bonUid: 'b-rec', quantity: 7, expected: 9 }],
    });
    const data = await pull();
    const p = data.products.find((x: { uid: string }) => x.uid === 'p-prix');
    assert.deepEqual([p.unitPrice, p.supplier, p.maxStock], [3.5, 'Fournisseur X', 40]);
    assert.equal(data.bons.find((b: { uid: string }) => b.uid === 'b-rec').orderUid, 'b-cmd');
    assert.equal(data.bonItems.find((i: { uid: string }) => i.uid === 'i-inv').expected, 9);
  });

  test('un payload invalide est refusé', async () => {
    const res = await push({ products: [{ uid: 'x', updatedAt: '2026-01-01' }] }); // name manquant
    assert.equal(res.status, 400);
  });
});

describe('migration des anciennes tables', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer({
      setupDb: path => {
        const old = new Database(path);
        old.exec(`
          CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, reference TEXT, barcode TEXT, category TEXT,
            unit TEXT, minStock REAL, stockInitial REAL, description TEXT, updatedAt TEXT);
          CREATE TABLE movements (id INTEGER PRIMARY KEY, productId INTEGER, type TEXT, date TEXT, quantity REAL, bonNumber TEXT, note TEXT);
          CREATE TABLE bons (id INTEGER PRIMARY KEY, number TEXT, date TEXT, type TEXT, note TEXT, destination TEXT,
            isFormal INTEGER, fileName TEXT, fileType TEXT, fileData TEXT);
          CREATE TABLE bon_items (id INTEGER PRIMARY KEY, bonId INTEGER, productId INTEGER, quantity REAL, note TEXT);
          INSERT INTO products VALUES (7, 'Vis', 'V-1', '', '', 'pièce', 0, 50, '', '2026-01-01');
          INSERT INTO bons VALUES (3, 'STK-2026-0001', '2026-01-01', 'sortie', '', 'Chantier', 0, NULL, NULL, NULL);
          INSERT INTO movements VALUES (9, 7, 'sortie', '2026-01-01', 5, 'STK-2026-0001', '');
          INSERT INTO bon_items VALUES (4, 3, 7, 5, '');
        `);
        old.close();
      },
    });
  });

  after(async () => {
    if (server) await server.close();
  });

  test('les lignes existantes reçoivent les uid legacy attendus par les postes', async () => {
    const token = await server.login();
    const res = await fetch(`${server.baseUrl}/sync/pull?since=0`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    assert.equal(data.products[0].uid, 'legacy-products-7');
    assert.equal(data.products[0].updatedAt, '1970-01-01T00:00:00.000Z');
    assert.equal(data.movements[0].productUid, 'legacy-products-7');
    assert.equal(data.movements[0].bonUid, 'legacy-bons-3', 'mouvement relié à son bon par le numéro');
    assert.equal(data.bonItems[0].bonUid, 'legacy-bons-3');
    assert.equal(data.bons[0].isFormal, false);
  });
});
