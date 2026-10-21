import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextBonNumber, computeStockLevels, orderProgress, ordersWithProgress, quantitiesOnOrder,
  reorderSuggestions, inventoryLines, formatMoney,
} from '../src/lib/stock.ts';
import type { Product } from '../shared/schemas.ts';

const product = (id: number, extra: Partial<Product> = {}): Product => ({
  id, name: `P${id}`, reference: '', barcode: '', category: '', unit: 'pièce',
  minStock: 0, stockInitial: 0, description: '', ...extra,
});

describe('numérotation des commandes et inventaires', () => {
  test('séries CMD et INV indépendantes', () => {
    assert.equal(nextBonNumber(['STK-2026-0004', 'CMD-2026-0002'], 2026, 'commande'), 'CMD-2026-0003');
    assert.equal(nextBonNumber(['CMD-2026-0002'], 2026, 'inventaire'), 'INV-2026-0001');
  });
});

describe('valeur du stock', () => {
  test('quantité × prix unitaire, un stock négatif ne vaut rien', () => {
    const [a, b] = computeStockLevels(
      [product(1, { stockInitial: 10, unitPrice: 2.5 }), product(2, { stockInitial: 0, unitPrice: 4 })],
      [{ productId: 2, type: 'sortie', quantity: 3 }],
    );
    assert.equal(a.value, 25);
    assert.equal(b.qty, -3);
    assert.equal(b.value, 0);
  });

  test('formatMoney : deux décimales, devise facultative', () => {
    assert.match(formatMoney(1234.5), /^1\s?234,50$/);
    assert.match(formatMoney(3, 'DH'), /^3,00 DH$/);
  });
});

describe('commandes fournisseur', () => {
  test('avancement : ouverte, partielle, reçue', () => {
    const ordered = [{ productId: 1, quantity: 10 }, { productId: 2, quantity: 5 }];
    assert.equal(orderProgress(ordered, []).status, 'ouverte');

    const partial = orderProgress(ordered, [{ productId: 1, quantity: 4 }]);
    assert.equal(partial.status, 'partielle');
    assert.deepEqual(partial.lines.find(l => l.productId === 1), { productId: 1, ordered: 10, received: 4, remaining: 6 });

    // Recevoir plus que commandé solde la ligne sans reste négatif.
    const done = orderProgress(ordered, [{ productId: 1, quantity: 12 }, { productId: 2, quantity: 5 }]);
    assert.equal(done.status, 'recue');
    assert.equal(done.lines[0].remaining, 0);
  });

  test('les réceptions sont rattachées à leur commande par uid', () => {
    const bons = [
      { id: 1, uid: 'cmd-1', type: 'commande', orderUid: null },
      { id: 2, uid: 'rec-1', type: 'entree', orderUid: 'cmd-1' },
      { id: 3, uid: 'rec-2', type: 'entree', orderUid: null }, // réception sans commande
    ];
    const items = [
      { bonId: 1, productId: 7, quantity: 10 },
      { bonId: 2, productId: 7, quantity: 3 },
      { bonId: 3, productId: 7, quantity: 50 },
    ];
    const [order] = ordersWithProgress(bons, items);
    assert.equal(order.receptions.length, 1);
    assert.equal(order.status, 'partielle');
    assert.equal(quantitiesOnOrder([order]).get(7), 7);
  });
});

describe('propositions de réapprovisionnement', () => {
  const levels = computeStockLevels([
    product(1, { name: 'Sous le minimum', stockInitial: 2, minStock: 5, supplier: 'B' }),
    product(2, { name: 'Au-dessus', stockInitial: 20, minStock: 5 }),
    product(3, { name: 'Cible définie', stockInitial: 1, minStock: 4, maxStock: 50, supplier: 'A' }),
    product(4, { name: 'Sans minimum, épuisé', stockInitial: 0 }),
  ], []);

  test('quantité pour remonter au stock cible (défaut : 2 × minimum), triée par fournisseur', () => {
    const s = reorderSuggestions(levels, new Map());
    assert.deepEqual(s.map(r => [r.product.name, r.suggested]), [['Cible définie', 49], ['Sous le minimum', 8]]);
  });

  test('les quantités déjà commandées sont déduites', () => {
    const s = reorderSuggestions(levels, new Map([[1, 8]]));
    // Stock + commande atteignent la cible : le produit reste listé (« couvert »), sans quantité.
    assert.deepEqual(s.find(r => r.product.id === 1)?.suggested, 0);
    const partial = reorderSuggestions(levels, new Map([[1, 2]]));
    assert.equal(partial.find(r => r.product.id === 1)?.suggested, 6);
  });
});

describe('inventaire', () => {
  test('écarts des seuls produits comptés, valorisés', () => {
    const levels = computeStockLevels([
      product(1, { stockInitial: 10, unitPrice: 2 }),
      product(2, { stockInitial: 5 }),
      product(3, { stockInitial: 8 }),
    ], []);
    const lines = inventoryLines(levels, { 1: '7', 2: 5, 3: '' });
    assert.deepEqual(lines, [
      { productId: 1, expected: 10, counted: 7, diff: -3, diffValue: -6 },
      { productId: 2, expected: 5, counted: 5, diff: 0, diffValue: 0 },
    ]);
  });
});
