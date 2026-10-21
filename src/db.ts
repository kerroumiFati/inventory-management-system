import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { Product, Movement, Bon, BonItem, BonType, SyncTable } from '../shared/schemas';
import { nextBonNumber, bonPrefix, type InventoryLine } from './lib/stock';
import { newUid } from './lib/uid';

// Suppression locale en attente d'envoi au serveur.
export interface LocalTombstone {
  id?: number;
  tbl: SyncTable;
  uid: string;
  deletedAt: string;
}

// Clés localStorage de l'ancienne synchro (remplacement complet), lues une seule fois par la migration v5.
const LEGACY_DIRTY_KEY    = 'stock_sync_dirty';
const LEGACY_LAST_SYNC    = 'stock_sync_last';
const LEGACY_REVISION_KEY = 'stock_sync_revision';
const LEGACY_DATE = '1970-01-01T00:00:00.000Z';

// Utilisateur connecté sur ce poste (enregistré par AuthContext), pour tracer qui saisit quoi.
const AUTH_USER_KEY = 'stock_auth_user';

function currentUsername(): string | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_USER_KEY);
    return raw ? (JSON.parse(raw) as { username?: string }).username || undefined : undefined;
  } catch {
    return undefined;
  }
}

class StockManagerDB extends Dexie {
  products!: EntityTable<Product, 'id'>;
  movements!: EntityTable<Movement, 'id'>;
  bons!: EntityTable<Bon, 'id'>;
  bonItems!: EntityTable<BonItem, 'id'>;
  tombstones!: EntityTable<LocalTombstone, 'id'>;

  constructor(name = 'StockManagerDB') {
    super(name);

    this.version(1).stores({
      products:  '++id, name, reference, category, unit',
      movements: '++id, productId, type, date, quantity, bonNumber',
      bons:      '++id, number, date, type, note',
      bonItems:  '++id, bonId, productId, quantity, note',
    });

    this.version(2).stores({
      products:  '++id, name, reference, category, unit, barcode',
      movements: '++id, productId, type, date, quantity, bonNumber',
      bons:      '++id, number, date, type, note',
      bonItems:  '++id, bonId, productId, quantity, note',
    });

    this.version(3).stores({
      products:  '++id, name, reference, category, unit, barcode',
      movements: '++id, productId, type, date, quantity, bonNumber, sortieId',
      bons:      '++id, number, date, type, note',
      bonItems:  '++id, bonId, productId, quantity, note',
      sorties:   '++id, date',
    });

    // v4 : fusion sorties → bons. Les bons portent maintenant
    // la pièce jointe (fileData en base64) et isFormal.
    this.version(4).stores({
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
      } catch {
        // Pas de sorties à migrer
      }
    });

    // v5 : synchronisation par fusion. Chaque ligne reçoit un uid global, une date de
    // modification et un marqueur « non envoyée » ; les mouvements sont liés à leur bon par id.
    this.version(5).stores({
      products:   '++id, &uid, name, reference, category, unit, barcode, dirty',
      movements:  '++id, &uid, productId, bonId, type, date, quantity, bonNumber, dirty',
      bons:       '++id, &uid, number, date, type, destination, dirty',
      bonItems:   '++id, &uid, bonId, productId, quantity, note, dirty',
      tombstones: '++id',
    }).upgrade(async tx => {
      // uid « legacy-<table>-<id> » : identiques à ceux de la migration serveur, si bien qu'un
      // poste déjà synchronisé retrouve ses lignes. Un poste qui avait des modifications non
      // envoyées (ou jamais synchronisé) les marque toutes à envoyer : rien n'est perdu.
      const ls = typeof localStorage === 'undefined' ? null : localStorage;
      const neverSynced = !ls?.getItem(LEGACY_LAST_SYNC) && !ls?.getItem(LEGACY_REVISION_KEY);
      const pending = ls?.getItem(LEGACY_DIRTY_KEY) === '1' || neverSynced;
      const meta = pending
        ? { updatedAt: new Date().toISOString(), dirty: 1 }
        : { updatedAt: LEGACY_DATE, dirty: 0 };

      const bonIdByNumber = new Map<string, number>();
      await tx.table('bons').each((b: Bon) => { if (b.id != null) bonIdByNumber.set(b.number, b.id); });

      for (const tbl of ['products', 'movements', 'bons', 'bonItems'] as const) {
        await tx.table(tbl).toCollection().modify((row: Movement) => {
          row.uid = `legacy-${tbl}-${row.id}`;
          Object.assign(row, meta);
          if (tbl === 'movements' && row.bonNumber && row.bonId == null) {
            const bonId = bonIdByNumber.get(row.bonNumber);
            if (bonId != null) row.bonId = bonId;
          }
        });
      }
      ls?.removeItem(LEGACY_DIRTY_KEY);
      ls?.removeItem(LEGACY_REVISION_KEY);
    });

    // v6 : commandes fournisseur (une réception référence sa commande par orderUid) et inventaires.
    this.version(6).stores({
      bons: '++id, &uid, number, date, type, destination, orderUid, dirty',
    });

    this.installSyncHooks();
  }

  // Toute écriture locale reçoit un uid, une date de modification et le marqueur « à envoyer ».
  // Les écritures de la synchro elle-même (transaction marquée par syncTransaction) sont exclues.
  private installSyncHooks() {
    for (const table of [this.products, this.movements, this.bons, this.bonItems]) {
      table.hook('creating', (_key, obj: { uid?: string; updatedAt?: string; dirty?: number }, tx) => {
        if (isSyncTransaction(tx)) return;
        obj.uid ??= newUid();
        obj.updatedAt = new Date().toISOString();
        obj.dirty = 1;
      });
      table.hook('updating', (mods, _key, obj, tx) => {
        if (isSyncTransaction(tx)) return;
        const changes: Record<string, unknown> = { updatedAt: new Date().toISOString(), dirty: 1 };
        // Un formulaire qui renverrait uid: undefined ne doit pas effacer l'identité de la ligne.
        if ('uid' in mods && !(mods as { uid?: string }).uid) changes.uid = obj.uid;
        return changes;
      });
    }
    // Auteur des saisies : renseigné à la création seulement (une ligne reçue garde le sien).
    for (const table of [this.movements, this.bons]) {
      table.hook('creating', (_key, obj: { createdBy?: string }, tx) => {
        if (isSyncTransaction(tx)) return;
        obj.createdBy ??= currentUsername();
      });
    }
  }
}

type SyncAwareTransaction = Transaction & { fromSync?: boolean };

function isSyncTransaction(tx: Transaction): boolean {
  return (tx as SyncAwareTransaction).fromSync === true;
}

export const db = new StockManagerDB();
export { StockManagerDB };

// Exécute `fn` dans une transaction sur toutes les tables, dont les écritures
// ne sont pas considérées comme des modifications locales.
export function syncTransaction<T>(database: StockManagerDB, fn: () => Promise<T>): Promise<T> {
  return database.transaction('rw',
    [database.products, database.movements, database.bons, database.bonItems, database.tombstones],
    () => {
      (Dexie.currentTransaction as SyncAwareTransaction).fromSync = true;
      return fn();
    });
}

// Enregistre la suppression de lignes pour qu'elle soit propagée aux autres postes.
async function recordDeletions(tbl: SyncTable, rows: { uid?: string }[]) {
  const deletedAt = new Date().toISOString();
  const tombstones = rows.filter(r => r.uid).map(r => ({ tbl, uid: r.uid!, deletedAt }));
  if (tombstones.length) await db.tombstones.bulkAdd(tombstones);
}

// ── Helpers ────────────────────────────────────────────────────────────────

export async function getNextBonNumber(type: BonType = 'sortie'): Promise<string> {
  const year    = new Date().getFullYear();
  const numbers = await db.bons.where('number').startsWith(`${bonPrefix(type)}-${year}-`).keys();
  return nextBonNumber(numbers.map(String), year, type);
}

export async function getProductByBarcode(barcode: string): Promise<Product | undefined> {
  return db.products.where('barcode').equals(barcode).first();
}

// Calcul pur : stock initial + somme des mouvements (entrée/sortie).
// Ne dépend pas de Dexie — testable isolément (voir tests/stock-calculation.test.ts).
export function computeStockDisponible(
  stockInitial: number | undefined,
  movements: Pick<Movement, 'type' | 'quantity'>[]
): number {
  return Number(stockInitial || 0) + movements.reduce(
    (acc, m) => m.type === 'entree' ? acc + m.quantity : acc - m.quantity, 0
  );
}

// Calcul stock disponible pour un produit
export async function getStockDisponible(productId: number): Promise<number> {
  const product = await db.products.get(productId);
  const mvts    = await db.movements.where('productId').equals(productId).toArray();
  return computeStockDisponible(product?.stockInitial, mvts);
}

export interface StockIssueItem {
  productId: number | string;
  quantity: number | string;
}

export interface StockIssue {
  name: string;
  requested: number;
  available: number;
  unit: string;
}

interface StockInfo {
  name?: string;
  unit?: string;
  available: number;
}

// Calcul pur : parmi une liste d'items demandés, lesquels dépassent le stock disponible.
// Les lignes portant sur un même produit sont additionnées avant comparaison.
export function findStockIssues(
  items: StockIssueItem[],
  stockByProductId: Map<number, StockInfo>
): StockIssue[] {
  const requestedByProduct = new Map<number, number>();
  for (const item of items) {
    if (!item.productId || !Number(item.quantity)) continue;
    const pid = Number(item.productId);
    requestedByProduct.set(pid, (requestedByProduct.get(pid) ?? 0) + Number(item.quantity));
  }
  const issues: StockIssue[] = [];
  for (const [pid, requested] of requestedByProduct) {
    const info      = stockByProductId.get(pid);
    const available = info?.available ?? 0;
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
export async function checkStockDisponible(items: StockIssueItem[]): Promise<StockIssue[]> {
  const stockByProductId = new Map<number, StockInfo>();
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

export interface NewBon {
  type: Exclude<BonType, 'inventaire'>;
  destination: string;
  note: string;
  items: { productId: number; quantity: number; note: string }[];
  file: { name: string; type: string; data: string } | null;
  // Réception d'une commande : uid de la commande.
  orderUid?: string | null;
}

// Crée un bon et ses mouvements en une seule transaction : en cas d'erreur, rien n'est
// enregistré (pas de bon sans mouvements). Une commande n'a pas de mouvement : le stock
// ne change qu'à sa réception.
export async function createBon({ type, destination, note, items, file, orderUid = null }: NewBon): Promise<number> {
  return db.transaction('rw', db.bons, db.bonItems, db.movements, async () => {
    const date   = new Date().toISOString();
    const number = await getNextBonNumber(type);
    const bonId  = await db.bons.add({
      number, date, type, destination, note, isFormal: false,
      fileName: file?.name || null,
      fileType: file?.type || null,
      fileData: file?.data || null,
      orderUid: type === 'entree' ? orderUid : null,
    }) as number; // l'id auto-incrémenté est toujours défini une fois l'ajout terminé
    await db.bonItems.bulkAdd(items.map(i => ({ bonId, ...i })));
    if (type === 'sortie' || type === 'entree') {
      await db.movements.bulkAdd(items.map(i => ({
        productId: i.productId, bonId, type, date,
        quantity: i.quantity, bonNumber: number, note: i.note,
      })));
    }
    return bonId;
  });
}

// Enregistre un inventaire : un bon INV (quantités comptées et théoriques) et, pour chaque
// écart, un mouvement d'ajustement qui ramène le stock à la quantité comptée.
export async function createInventory({ scope, note, lines }: { scope: string; note: string; lines: InventoryLine[] }): Promise<number> {
  return db.transaction('rw', db.bons, db.bonItems, db.movements, async () => {
    const date   = new Date().toISOString();
    const number = await getNextBonNumber('inventaire');
    const bonId  = await db.bons.add({
      number, date, type: 'inventaire', destination: scope, note, isFormal: false,
      fileName: null, fileType: null, fileData: null, orderUid: null,
    }) as number;
    await db.bonItems.bulkAdd(lines.map(l => ({
      bonId, productId: l.productId, quantity: l.counted, expected: l.expected, note: '',
    })));
    await db.movements.bulkAdd(lines.filter(l => l.diff !== 0).map(l => ({
      productId: l.productId, bonId, date,
      type: l.diff > 0 ? 'entree' as const : 'sortie' as const,
      quantity: Math.abs(l.diff), bonNumber: number, note: "Écart d'inventaire",
    })));
    return bonId;
  });
}

// Mouvements d'un bon : liés par bonId ; les anciens mouvements sans bonId le sont par numéro.
function bonMovements(bon: Pick<Bon, 'id' | 'number'>) {
  return db.movements.filter(m => m.bonId === bon.id || (m.bonId == null && !!bon.number && m.bonNumber === bon.number));
}

// Supprime un bon, ses lignes et les mouvements de stock associés (le stock est restitué).
export async function deleteBon(bon: Pick<Bon, 'id' | 'number'>): Promise<void> {
  if (bon.id == null) return;
  const bonId = bon.id;
  await db.transaction('rw', db.bons, db.bonItems, db.movements, db.tombstones, async () => {
    const [items, mvts, row] = await Promise.all([
      db.bonItems.where('bonId').equals(bonId).toArray(),
      bonMovements(bon).toArray(),
      db.bons.get(bonId),
    ]);
    await recordDeletions('bonItems', items);
    await recordDeletions('movements', mvts);
    if (row) await recordDeletions('bons', [row]);
    await db.bonItems.bulkDelete(items.map(i => i.id!));
    await db.movements.bulkDelete(mvts.map(m => m.id!));
    await db.bons.delete(bonId);
  });
}

// Supprime un produit (l'appelant vérifie au préalable qu'il n'est pas utilisé).
export async function deleteProduct(productId: number): Promise<void> {
  await db.transaction('rw', db.products, db.tombstones, async () => {
    const row = await db.products.get(productId);
    if (!row) return;
    await recordDeletions('products', [row]);
    await db.products.delete(productId);
  });
}

// Nombre de mouvements / lignes de bon qui référencent un produit.
export async function countProductUsage(productId: number): Promise<number> {
  const [mvts, items] = await Promise.all([
    db.movements.where('productId').equals(productId).count(),
    db.bonItems.where('productId').equals(productId).count(),
  ]);
  return mvts + items;
}

// Conversion ArrayBuffer → base64 (pour stockage JSON/SQLite)
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Conversion base64 → Blob
export function base64ToBlob(b64: string, mimeType: string | null | undefined): Blob {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || undefined });
}
