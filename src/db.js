import Dexie from 'dexie';

export const db = new Dexie('StockManagerDB');

db.version(1).stores({
  products:  '++id, name, reference, category, unit',
  movements: '++id, productId, type, date, quantity, bonNumber',
  bons:      '++id, number, date, type, note',
  bonItems:  '++id, bonId, productId, quantity, note',
});

db.version(2).stores({
  products:  '++id, name, reference, category, unit, barcode',
  movements: '++id, productId, type, date, quantity, bonNumber',
  bons:      '++id, number, date, type, note',
  bonItems:  '++id, bonId, productId, quantity, note',
});

db.version(3).stores({
  products:  '++id, name, reference, category, unit, barcode',
  movements: '++id, productId, type, date, quantity, bonNumber, sortieId',
  bons:      '++id, number, date, type, note',
  bonItems:  '++id, bonId, productId, quantity, note',
  sorties:   '++id, date',
});

// v4 : fusion sorties → bons. Les bons portent maintenant
// la pièce jointe (fileData en base64) et isFormal.
db.version(4).stores({
  products:  '++id, name, reference, category, unit, barcode',
  movements: '++id, productId, type, date, quantity, bonNumber',
  bons:      '++id, number, date, type, destination',
  bonItems:  '++id, bonId, productId, quantity, note',
  sorties:   null, // suppression
}).upgrade(async tx => {
  // Migrer les sorties existantes vers bons + bonItems
  try {
    const sorties = await tx.table('sorties').toArray();
    const year = new Date().getFullYear();
    let n = (await tx.table('bons').count()) + 1;
    for (const s of sorties) {
      const number = `STK-${year}-${String(n++).padStart(4, '0')}`;
      const bonId = await tx.table('bons').add({
        number, date: s.date, type: 'sortie',
        note: s.note || '', destination: s.destination || '',
        isFormal: false,
        fileName: s.fileName || null,
        fileType: s.fileType || null,
        fileData: s.fileData || null,
      });
      // Recréer bonItems depuis les mouvements liés
      const mvts = await tx.table('movements')
        .where('sortieId').equals(s.id).toArray();
      for (const m of mvts) {
        await tx.table('bonItems').add({
          bonId, productId: m.productId,
          quantity: m.quantity, note: m.note || '',
        });
        await tx.table('movements').update(m.id, { bonNumber: number });
      }
    }
  } catch (e) {
    // Pas de sorties à migrer
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

export async function getNextBonNumber() {
  const count = await db.bons.count();
  const year  = new Date().getFullYear();
  return `STK-${year}-${String(count + 1).padStart(4, '0')}`;
}

export async function getProductByBarcode(barcode) {
  return db.products.where('barcode').equals(barcode).first();
}

// Calcul pur : stock initial + somme des mouvements (entrée/sortie).
// Ne dépend pas de Dexie — testable isolément (voir tests/stock-calculation.test.js).
export function computeStockDisponible(stockInitial, movements) {
  return Number(stockInitial || 0) + movements.reduce(
    (acc, m) => m.type === 'entree' ? acc + m.quantity : acc - m.quantity, 0
  );
}

// Calcul stock disponible pour un produit
export async function getStockDisponible(productId) {
  const product = await db.products.get(productId);
  const mvts    = await db.movements.where('productId').equals(productId).toArray();
  return computeStockDisponible(product?.stockInitial, mvts);
}

// Calcul pur : parmi une liste d'items demandés, lesquels dépassent le stock disponible.
// `stockByProductId` est une Map<productId, { name, unit, available }>.
export function findStockIssues(items, stockByProductId) {
  const issues = [];
  for (const item of items) {
    if (!item.productId || !Number(item.quantity)) continue;
    const pid       = Number(item.productId);
    const info      = stockByProductId.get(pid);
    const available = info?.available ?? 0;
    const requested = Number(item.quantity);
    if (requested > available) {
      issues.push({
        name: info?.name || `#${pid}`,
        requested,
        available,
        unit: info?.unit || '',
      });
    }
  }
  return issues;
}

// Vérifie stock pour une liste d'items — retourne les problèmes
export async function checkStockDisponible(items) {
  const stockByProductId = new Map();
  for (const item of items) {
    if (!item.productId || !Number(item.quantity)) continue;
    const pid = Number(item.productId);
    if (stockByProductId.has(pid)) continue;
    const product   = await db.products.get(pid);
    const available = await getStockDisponible(pid);
    stockByProductId.set(pid, { name: product?.name, unit: product?.unit, available });
  }
  return findStockIssues(items, stockByProductId);
}

// Conversion ArrayBuffer → base64 (pour stockage JSON/SQLite)
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Conversion base64 → Blob
export function base64ToBlob(b64, mimeType) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
