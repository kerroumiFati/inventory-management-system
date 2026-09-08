import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeStockDisponible, findStockIssues } from '../src/db.js';

describe('computeStockDisponible', () => {
  test('additionne le stock initial et les entrées', () => {
    const stock = computeStockDisponible(100, [
      { type: 'entree', quantity: 20 },
      { type: 'entree', quantity: 5 },
    ]);
    assert.equal(stock, 125);
  });

  test('soustrait les sorties', () => {
    const stock = computeStockDisponible(100, [
      { type: 'sortie', quantity: 20 },
      { type: 'entree', quantity: 5 },
    ]);
    assert.equal(stock, 85);
  });

  test('peut devenir négatif si plus de sorties que de stock disponible', () => {
    const stock = computeStockDisponible(5, [{ type: 'sortie', quantity: 10 }]);
    assert.equal(stock, -5);
  });

  test('traite un stock initial absent comme 0', () => {
    const stock = computeStockDisponible(undefined, [{ type: 'entree', quantity: 3 }]);
    assert.equal(stock, 3);
  });
});

describe('findStockIssues', () => {
  test('ne signale rien quand le stock est suffisant', () => {
    const stock = new Map([[1, { name: 'Vis', unit: 'pièce', available: 50 }]]);
    const issues = findStockIssues([{ productId: 1, quantity: 10 }], stock);
    assert.deepEqual(issues, []);
  });

  test('signale un item quand la quantité demandée dépasse le disponible', () => {
    const stock = new Map([[1, { name: 'Vis', unit: 'pièce', available: 5 }]]);
    const issues = findStockIssues([{ productId: 1, quantity: 10 }], stock);
    assert.equal(issues.length, 1);
    assert.deepEqual(issues[0], { name: 'Vis', requested: 10, available: 5, unit: 'pièce' });
  });

  test('ignore les lignes sans produit ou sans quantité', () => {
    const stock = new Map();
    const issues = findStockIssues([{ productId: null, quantity: 10 }, { productId: 1, quantity: 0 }], stock);
    assert.deepEqual(issues, []);
  });
});
