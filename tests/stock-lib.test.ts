import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextBonNumber, stockStatus, computeStockLevels, stockInitialForTarget,
  parseNumber, formatQty, netMovementsByProduct, duplicateBonNumbers,
} from '../src/lib/stock.ts';
import { newUid } from '../src/lib/uid.ts';
import { BonSchema } from '../shared/schemas.ts';

describe('nextBonNumber', () => {
  test('démarre à 0001 quand aucun bon n\'existe pour l\'année', () => {
    assert.equal(nextBonNumber([], 2026), 'STK-2026-0001');
  });

  test('prend le max + 1, même après suppression d\'un bon intermédiaire', () => {
    // Bons 1 et 3 restants (le 2 a été supprimé) : un comptage donnerait 0003, déjà pris.
    assert.equal(nextBonNumber(['STK-2026-0001', 'STK-2026-0003'], 2026), 'STK-2026-0004');
  });

  test('ignore les numéros des autres années et les formats inconnus', () => {
    assert.equal(nextBonNumber(['STK-2025-0042', 'MANUEL-7', 'STK-2026-0002'], 2026), 'STK-2026-0003');
  });

  test('les réceptions ont leur propre série (REC)', () => {
    assert.equal(nextBonNumber(['STK-2026-0005', 'REC-2026-0002'], 2026, 'entree'), 'REC-2026-0003');
    assert.equal(nextBonNumber(['REC-2026-0009'], 2026, 'sortie'), 'STK-2026-0001');
  });
});

describe('duplicateBonNumbers', () => {
  test('repère les numéros attribués à plusieurs bons', () => {
    const dup = duplicateBonNumbers([{ number: 'STK-1' }, { number: 'STK-2' }, { number: 'STK-1' }]);
    assert.deepEqual([...dup], ['STK-1']);
  });
});

describe('newUid', () => {
  test('produit des UUID v4 distincts', () => {
    const a = newUid();
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(a, newUid());
  });
});

describe('stockStatus', () => {
  test('épuisé à 0 ou en négatif, même sans seuil', () => {
    assert.equal(stockStatus(0, 0), 'empty');
    assert.equal(stockStatus(-2, 5), 'empty');
  });

  test('faible quand ≤ seuil', () => {
    assert.equal(stockStatus(5, 5), 'low');
    assert.equal(stockStatus(3, 5), 'low');
  });

  test('OK au-dessus du seuil ou sans seuil', () => {
    assert.equal(stockStatus(6, 5), 'ok');
    assert.equal(stockStatus(1, 0), 'ok');
  });
});

describe('computeStockLevels', () => {
  test('combine stock initial, entrées et sorties, et cumule les sorties', () => {
    const [vis] = computeStockLevels(
      [{ id: 1, name: 'Vis', reference: '', barcode: '', category: '', unit: 'pièce', minStock: 10, stockInitial: 20, description: '' }],
      [
        { productId: 1, type: 'sortie', quantity: 15 },
        { productId: 1, type: 'entree', quantity: 3 },
        { productId: 2, type: 'sortie', quantity: 99 }, // autre produit : ignoré
      ]
    );
    assert.equal(vis.qty, 8);
    assert.equal(vis.used, 15);
    assert.equal(vis.status, 'low');
  });
});

describe('stockInitialForTarget (import Excel)', () => {
  test('ré-importer le stock exporté ne double pas les sorties', () => {
    // Stock initial 100, 30 sortis → stock affiché 70, exporté « Q. Actuel = 70 ».
    const net = netMovementsByProduct([{ productId: 1, type: 'sortie', quantity: 30 }]).get(1) ?? 0;
    const stockInitial = stockInitialForTarget(70, net);
    assert.equal(stockInitial, 100);
    assert.equal(stockInitial + net, 70);
  });
});

describe('parseNumber', () => {
  test('accepte la virgule décimale et les espaces', () => {
    assert.equal(parseNumber('12,5'), 12.5);
    assert.equal(parseNumber(' 1 200 '), 1200);
    assert.equal(parseNumber(3), 3);
  });

  test('renvoie 0 pour une valeur non numérique', () => {
    assert.equal(parseNumber('abc'), 0);
    assert.equal(parseNumber(undefined), 0);
  });
});

describe('formatQty', () => {
  test('supprime les erreurs d\'arrondi flottant', () => {
    assert.equal(formatQty(0.1 + 0.2, 'm'), '0.3 m');
    assert.equal(formatQty(5), '5');
  });
});

describe('BonSchema', () => {
  test('accepte isFormal au format SQLite (0/1)', () => {
    assert.equal(BonSchema.parse({ number: 'STK-2026-0001', date: '2026-01-01', isFormal: 0 }).isFormal, false);
    assert.equal(BonSchema.parse({ number: 'STK-2026-0001', date: '2026-01-01', isFormal: 1 }).isFormal, true);
  });
});
