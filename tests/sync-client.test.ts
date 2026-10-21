import 'fake-indexeddb/auto';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { db as dbA, StockManagerDB, createBon, createInventory, deleteBon, deleteProduct, computeStockDisponible } from '../src/db.ts';
import { computeStockLevels, inventoryLines, ordersWithProgress } from '../src/lib/stock.ts';
import { createSyncClient, type SyncClient } from '../src/services/sync.ts';
import { startTestServer, type TestServer } from '../server/tests/helpers.ts';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const tick = () => new Promise(r => setTimeout(r, 5)); // garantit des updatedAt distincts

// Poste A : la base principale de l'application (utilisée par createBon, deleteBon…).
// Poste B : une seconde base, écrite directement.
describe('synchronisation entre deux postes', () => {
  let server: TestServer;
  let dbB: StockManagerDB;
  let syncA: SyncClient;
  let syncB: SyncClient;

  before(async () => {
    server = await startTestServer();
    const token = await server.login();
    dbB = new StockManagerDB('PosteB');
    const options = { apiBase: server.baseUrl, getToken: () => token };
    syncA = createSyncClient({ ...options, database: dbA, storage: new MemoryStorage() });
    syncB = createSyncClient({ ...options, database: dbB, storage: new MemoryStorage() });
  });

  after(async () => {
    dbA.close();
    dbB.close();
    if (server) await server.close();
  });

  const productOn = (db: StockManagerDB, name: string) => db.products.where('name').equals(name).first();

  test('un produit créé sur A arrive sur B', async () => {
    await dbA.products.add({ name: 'Vis', reference: 'V-1', barcode: '', category: '', unit: 'pièce', minStock: 0, stockInitial: 100, description: '' });
    assert.equal(await syncA.pendingCount(), 1);
    const r = await syncA.sync();
    assert.equal(r.sent, 1);
    assert.equal(await syncA.pendingCount(), 0);

    await syncB.sync();
    const onB = await productOn(dbB, 'Vis');
    const onA = await productOn(dbA, 'Vis');
    assert.ok(onB);
    assert.equal(onB.uid, onA!.uid);
    assert.equal(onB.dirty, 0, 'une ligne reçue n\'est pas à renvoyer');
  });

  test('les mouvements saisis sur B sont rattachés au bon produit sur A (id locaux différents)', async () => {
    // Décale les id de B pour qu'ils ne coïncident pas avec ceux de A.
    await dbB.products.add({ name: 'Écrou', reference: '', barcode: '', category: '', unit: 'pièce', minStock: 0, stockInitial: 5, description: '' });
    const vis = await productOn(dbB, 'Vis');
    await dbB.movements.add({ productId: vis!.id!, type: 'sortie', date: new Date().toISOString(), quantity: 30, bonNumber: '', note: '' });
    await syncB.sync();
    await syncA.sync();

    const visA = await productOn(dbA, 'Vis');
    const mvts = await dbA.movements.where('productId').equals(visA!.id!).toArray();
    assert.equal(computeStockDisponible(visA!.stockInitial, mvts), 70);
    assert.ok(await productOn(dbA, 'Écrou'));
  });

  test('les saisies des deux postes s\'additionnent au lieu de s\'écraser', async () => {
    const visA = await productOn(dbA, 'Vis');
    const visB = await productOn(dbB, 'Vis');
    // Les deux postes saisissent une sortie sans s'être synchronisés entre-temps.
    await dbA.movements.add({ productId: visA!.id!, type: 'sortie', date: new Date().toISOString(), quantity: 10, bonNumber: '', note: '' });
    await dbB.movements.add({ productId: visB!.id!, type: 'sortie', date: new Date().toISOString(), quantity: 5, bonNumber: '', note: '' });
    await syncA.sync();
    await syncB.sync();
    await syncA.sync();

    for (const db of [dbA, dbB]) {
      const p = await productOn(db, 'Vis');
      const mvts = await db.movements.where('productId').equals(p!.id!).toArray();
      assert.equal(computeStockDisponible(p!.stockInitial, mvts), 55);
    }
  });

  test('un bon créé puis supprimé sur A est créé puis supprimé sur B', async () => {
    const visA = await productOn(dbA, 'Vis');
    const bonId = await createBon({
      type: 'sortie', destination: 'Chantier', note: '', file: null,
      items: [{ productId: visA!.id!, quantity: 2, note: '' }],
    });
    await syncA.sync();
    await syncB.sync();

    const bonB = await dbB.bons.where('destination').equals('Chantier').first();
    assert.ok(bonB);
    assert.equal(await dbB.bonItems.where('bonId').equals(bonB.id!).count(), 1);
    assert.equal(await dbB.movements.where('bonId').equals(bonB.id!).count(), 1, 'mouvement relié au bon par id');

    const bonA = await dbA.bons.get(bonId);
    await deleteBon(bonA!);
    await syncA.sync();
    await syncB.sync();
    assert.equal(await dbB.bons.count(), 0);
    assert.equal(await dbB.bonItems.count(), 0);
    assert.equal(await dbB.movements.where('bonNumber').equals(bonA!.number).count(), 0);
  });

  test('modification concurrente d\'un produit : la plus récente l\'emporte partout', async () => {
    const pA = await productOn(dbA, 'Écrou');
    const pB = await productOn(dbB, 'Écrou');
    await dbA.products.update(pA!.id!, { minStock: 1 });
    await tick();
    await dbB.products.update(pB!.id!, { minStock: 2 });
    await syncA.sync();
    const r = await syncB.sync();
    await syncA.sync();
    assert.equal(r.overridden, 0, 'la version de B est la plus récente');
    assert.equal((await dbA.products.get(pA!.id!))!.minStock, 2);
    assert.equal((await dbB.products.get(pB!.id!))!.minStock, 2);
  });

  test('un produit supprimé sur A mais utilisé entre-temps sur B est conservé partout', async () => {
    await dbA.products.add({ name: 'Colle', reference: '', barcode: '', category: '', unit: 'pièce', minStock: 0, stockInitial: 3, description: '' });
    await syncA.sync();
    await syncB.sync();

    const colleB = await productOn(dbB, 'Colle');
    await dbB.movements.add({ productId: colleB!.id!, type: 'sortie', date: new Date().toISOString(), quantity: 1, bonNumber: '', note: '' });
    const colleA = await productOn(dbA, 'Colle');
    await deleteProduct(colleA!.id!);
    await syncA.sync();

    await syncB.sync(); // reçoit la suppression, mais le produit est utilisé : il est renvoyé
    assert.ok(await productOn(dbB, 'Colle'));
    await syncB.sync();
    await syncA.sync();
    const back = await productOn(dbA, 'Colle');
    assert.ok(back, 'le produit revient sur A');
    assert.equal(await dbA.movements.where('productId').equals(back.id!).count(), 1);
  });

  test('un inventaire validé sur A ajuste le stock de B, avec l\'auteur de la saisie', async () => {
    // Utilisateur connecté sur le « poste » (lu par les hooks de création).
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = new MemoryStorage();
    storage.setItem('stock_auth_user', JSON.stringify({ username: 'alice', role: 'user' }));
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    try {
      const levels = computeStockLevels(await dbA.products.toArray(), await dbA.movements.toArray());
      const vis = levels.find(p => p.name === 'Vis')!;
      const lines = inventoryLines(levels, { [vis.id!]: vis.qty - 3 });
      const bonId = await createInventory({ scope: 'Tout le stock', note: '', lines });
      const bon = await dbA.bons.get(bonId);
      assert.match(bon!.number, /^INV-\d{4}-0001$/);
      assert.equal(bon!.createdBy, 'alice');
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
    await syncA.sync();
    await syncB.sync();

    const visB = await productOn(dbB, 'Vis');
    const visA = await productOn(dbA, 'Vis');
    const stockOf = async (db: StockManagerDB, p: typeof visA) =>
      computeStockDisponible(p!.stockInitial, await db.movements.where('productId').equals(p!.id!).toArray());
    assert.equal(await stockOf(dbB, visB), await stockOf(dbA, visA));
    const inv = await dbB.bons.where('type').equals('inventaire').first();
    const item = await dbB.bonItems.where('bonId').equals(inv!.id!).first();
    assert.equal(item!.expected! - item!.quantity, 3, 'théorique et compté transmis');
    const adj = await dbB.movements.where('bonId').equals(inv!.id!).first();
    assert.deepEqual([adj!.type, adj!.quantity, adj!.createdBy], ['sortie', 3, 'alice']);
  });

  test('une commande passée sur A et réceptionnée sur B est soldée partout, sans toucher au stock avant réception', async () => {
    const ecrouA = await productOn(dbA, 'Écrou');
    const mvtsBefore = await dbA.movements.count();
    await createBon({
      type: 'commande', destination: 'Fournisseur X', note: '', file: null,
      items: [{ productId: ecrouA!.id!, quantity: 20, note: '' }],
    });
    assert.equal(await dbA.movements.count(), mvtsBefore, 'une commande ne crée pas de mouvement');
    await syncA.sync();
    await syncB.sync();

    // Réception partielle sur B, rattachée à la commande par son uid.
    const order = await dbB.bons.where('type').equals('commande').first();
    const ecrouB = await productOn(dbB, 'Écrou');
    const recId = await dbB.bons.add({
      number: 'REC-2026-0099', date: new Date().toISOString(), type: 'entree', note: '', destination: 'Fournisseur X',
      isFormal: false, fileName: null, fileType: null, fileData: null, orderUid: order!.uid,
    }) as number;
    await dbB.bonItems.add({ bonId: recId, productId: ecrouB!.id!, quantity: 12, note: '' });
    await dbB.movements.add({ productId: ecrouB!.id!, bonId: recId, type: 'entree', date: new Date().toISOString(), quantity: 12, bonNumber: 'REC-2026-0099', note: '' });
    await syncB.sync();
    await syncA.sync();

    const [info] = ordersWithProgress(await dbA.bons.toArray(), await dbA.bonItems.toArray());
    assert.equal(info.status, 'partielle');
    assert.equal(info.receptions.length, 1);
    assert.equal(info.lines[0].remaining, 8);
  });
});

describe('migration de la base locale vers la v5', () => {
  test('les lignes existantes reçoivent un uid legacy et les mouvements leur bon', async () => {
    const name = 'MigrationTest';
    const old = new Dexie(name);
    old.version(4).stores({
      products:  '++id, name, reference, category, unit, barcode',
      movements: '++id, productId, type, date, quantity, bonNumber',
      bons:      '++id, number, date, type, destination',
      bonItems:  '++id, bonId, productId, quantity, note',
    });
    await old.table('products').add({ id: 7, name: 'Vis', stockInitial: 10 });
    await old.table('bons').add({ id: 3, number: 'STK-2026-0001', date: '2026-01-01', type: 'sortie' });
    await old.table('movements').add({ id: 9, productId: 7, type: 'sortie', date: '2026-01-01', quantity: 2, bonNumber: 'STK-2026-0001' });
    old.close();

    const upgraded = new StockManagerDB(name);
    const p = await upgraded.products.get(7);
    const m = await upgraded.movements.get(9);
    assert.equal(p!.uid, 'legacy-products-7');
    assert.equal(m!.uid, 'legacy-movements-9');
    assert.equal(m!.bonId, 3);
    // Pas d'historique de synchro connu : tout est marqué à envoyer (rien ne peut être perdu).
    assert.equal(p!.dirty, 1);
    upgraded.close();
  });
});
