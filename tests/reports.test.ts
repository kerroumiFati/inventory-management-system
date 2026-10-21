import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { consumptionByDestination, dormantProducts, flowsByProduct, inPeriod, periodPresets } from '../src/lib/reports.ts';
import { computeStockLevels } from '../src/lib/stock.ts';
import type { Product } from '../shared/schemas.ts';

const product = (id: number, extra: Partial<Product> = {}): Product => ({
  id, name: `P${id}`, reference: '', barcode: '', category: '', unit: 'pièce',
  minStock: 0, stockInitial: 0, description: '', ...extra,
});

// Midi UTC : le jour local est le même dans tous les fuseaux d'Europe/Afrique.
const at = (day: string) => `${day}T12:00:00.000Z`;

const products = [product(1, { unitPrice: 2, stockInitial: 100 }), product(2, { unitPrice: 10, stockInitial: 10 })];
const bons = [
  { id: 1, type: 'sortie', destination: 'Chantier A' },
  { id: 2, type: 'sortie', destination: 'Chantier B' },
  { id: 3, type: 'inventaire', destination: 'Tout le stock' },
  { id: 4, type: 'sortie', destination: 'Chantier A' },
];
const movements = [
  { productId: 1, type: 'sortie' as const, quantity: 10, date: at('2026-03-05'), bonId: 1 },
  { productId: 2, type: 'sortie' as const, quantity: 1, date: at('2026-03-06'), bonId: 2 },
  { productId: 1, type: 'sortie' as const, quantity: 4, date: at('2026-03-07'), bonId: 3 }, // ajustement d'inventaire
  { productId: 1, type: 'sortie' as const, quantity: 5, date: at('2026-03-20'), bonId: 4 },
  { productId: 1, type: 'sortie' as const, quantity: 99, date: at('2026-04-01'), bonId: 1 }, // hors période
  { productId: 2, type: 'entree' as const, quantity: 3, date: at('2026-03-10') },
];
const march = { from: '2026-03-01', to: '2026-03-31' };

describe('rapports', () => {
  test('inPeriod inclut les deux bornes', () => {
    assert.ok(inPeriod(at('2026-03-01'), march));
    assert.ok(inPeriod(at('2026-03-31'), march));
    assert.ok(!inPeriod(at('2026-04-01'), march));
  });

  test('consommation par produit : période seule, sans les ajustements d\'inventaire', () => {
    const rows = flowsByProduct('sortie', movements, bons, products, march);
    assert.deepEqual(rows.map(r => [r.productId, r.quantity, r.value, r.count]), [[1, 15, 30, 2], [2, 1, 10, 1]]);
    assert.deepEqual(flowsByProduct('entree', movements, bons, products, march).map(r => r.value), [30]);
  });

  test('consommation par destination', () => {
    assert.deepEqual(consumptionByDestination(movements, bons, products, march), [
      { destination: 'Chantier A', bons: 2, value: 30 },
      { destination: 'Chantier B', bons: 1, value: 10 },
    ]);
  });

  test('stock dormant : en stock et sans mouvement depuis N jours', () => {
    const levels = computeStockLevels([
      product(1, { stockInitial: 5 }), product(2, { stockInitial: 5 }), product(3, { stockInitial: 0 }), product(4, { stockInitial: 2 }),
    ], []);
    const mvts = [
      { productId: 1, type: 'entree' as const, quantity: 1, date: at('2026-01-01') },
      { productId: 2, type: 'entree' as const, quantity: 1, date: at('2026-03-25') },
    ];
    const dormant = dormantProducts(levels, mvts, 30, new Date(at('2026-04-01')));
    // P2 a bougé récemment, P3 est vide. À valeur égale, le plus ancien d'abord (P4 n'a jamais bougé).
    assert.deepEqual(dormant.map(d => [d.product.id, d.lastMovement]), [[4, null], [1, at('2026-01-01')]]);
  });

  test('périodes prédéfinies cohérentes', () => {
    const presets = periodPresets(new Date(2026, 2, 15, 12));
    assert.deepEqual(presets.find(p => p.key === 'month')!.period, { from: '2026-03-01', to: '2026-03-15' });
    assert.deepEqual(presets.find(p => p.key === 'lastMonth')!.period, { from: '2026-02-01', to: '2026-02-28' });
  });
});
