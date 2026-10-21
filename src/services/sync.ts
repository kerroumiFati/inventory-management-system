import { db as appDb, syncTransaction, type StockManagerDB } from '../db';
import { API_BASE } from '../config';
import { newUid } from '../lib/uid';
import type {
  Product, Movement, Bon, BonItem, SyncTable, SyncPushRequest, SyncPushResponse, SyncPullResponse,
  SyncProduct, SyncMovement, SyncBon, SyncBonItem, Tombstone,
} from '../../shared/schemas';

// Erreurs de synchronisation que l'interface traite spécifiquement.
export class SyncError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'network' | 'other') {
    super(message);
  }
}

export interface SyncResult {
  sent: number;
  received: number;
  // Modifications de ce poste écartées car un autre poste a modifié la même ligne plus récemment.
  overridden: number;
  // Lignes reçues dont le produit ou le bon n'existe pas sur ce poste (ignorées).
  orphans: number;
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface SyncClientOptions {
  database: StockManagerDB;
  apiBase: string;
  getToken: () => string | null;
  storage: KeyValueStorage;
}

// Taille approximative maximale d'un envoi (les pièces jointes sont en base64 dans les bons).
const MAX_BATCH_CHARS = 4_000_000;

const CLIENT_ID_KEY = 'stock_sync_client_id';
const REVISION_KEY  = 'stock_sync_rev';
const LAST_SYNC_KEY = 'stock_sync_last';

type Row = { id?: number; uid?: string; updatedAt?: string; dirty?: number };

// Copie de `obj` sans les clés indiquées (champs locaux non envoyés au serveur).
function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

export function createSyncClient({ database: db, apiBase, getToken, storage }: SyncClientOptions) {
  function clientId(): string {
    let id = storage.getItem(CLIENT_ID_KEY);
    if (!id) { id = newUid(); storage.setItem(CLIENT_ID_KEY, id); }
    return id;
  }

  function headers(): Record<string, string> {
    const token = getToken();
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${apiBase}${path}`, { ...init, headers: headers() });
    } catch {
      throw new SyncError('Serveur injoignable. Les modifications restent sur ce poste et seront envoyées plus tard.', 'network');
    }
    if (res.status === 401) throw new SyncError('Session expirée ou compte désactivé. Veuillez vous reconnecter.', 'auth');
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null;
      throw new SyncError(body?.error || `Erreur serveur (${res.status})`, 'other');
    }
    return res.json() as Promise<T>;
  }

  // ── Envoi ─────────────────────────────────────────────────
  async function push(): Promise<{ sent: number }> {
    const [products, bons] = await Promise.all([db.products.toArray(), db.bons.toArray()]);
    const productUid = new Map(products.map(p => [p.id, p.uid]));
    const bonUid     = new Map(bons.map(b => [b.id, b.uid]));

    const [dirtyMovements, dirtyItems, tombstones] = await Promise.all([
      db.movements.where('dirty').equals(1).toArray(),
      db.bonItems.where('dirty').equals(1).toArray(),
      db.tombstones.toArray(),
    ]);

    type Entry = { tbl: SyncTable; local: Row; wire: object } | { tbl: 'deletion'; id: number; wire: Tombstone };
    const entries: Entry[] = [];
    for (const p of products) if (p.dirty) entries.push({ tbl: 'products', local: p, wire: omit(p, 'id', 'dirty') satisfies Partial<SyncProduct> });
    for (const b of bons)     if (b.dirty) entries.push({ tbl: 'bons', local: b, wire: omit(b, 'id', 'dirty') satisfies Partial<SyncBon> });
    for (const m of dirtyMovements) {
      const pUid = productUid.get(m.productId);
      if (!pUid) continue; // produit supprimé localement : la ligne est orpheline
      const bUid = m.bonId != null ? bonUid.get(m.bonId) ?? null : null;
      const rest = omit(m, 'id', 'dirty', 'productId', 'bonId');
      entries.push({ tbl: 'movements', local: m, wire: { ...rest, productUid: pUid, bonUid: bUid } satisfies Partial<SyncMovement> });
    }
    for (const i of dirtyItems) {
      const pUid = productUid.get(i.productId);
      const bUid = bonUid.get(i.bonId);
      if (!pUid || !bUid) continue;
      const rest = omit(i, 'id', 'dirty', 'productId', 'bonId');
      entries.push({ tbl: 'bonItems', local: i, wire: { ...rest, productUid: pUid, bonUid: bUid } satisfies Partial<SyncBonItem> });
    }
    for (const t of tombstones) entries.push({ tbl: 'deletion', id: t.id!, wire: { tbl: t.tbl, uid: t.uid, deletedAt: t.deletedAt } });

    // Envoi par lots : un lot accepté est acquitté immédiatement, même si le suivant échoue.
    let sent = 0;
    let batch: Entry[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const body: SyncPushRequest = { clientId: clientId(), products: [], movements: [], bons: [], bonItems: [], deletions: [] };
      for (const e of batch) {
        if (e.tbl === 'deletion') body.deletions!.push(e.wire);
        else (body[e.tbl] as object[]).push(e.wire);
      }
      await request<SyncPushResponse>('/sync/push', { method: 'POST', body: JSON.stringify(body) });
      await acknowledge(batch);
      sent += batch.length;
      batch = [];
      size = 0;
    };
    for (const e of entries) {
      const len = JSON.stringify(e.wire).length;
      if (batch.length && size + len > MAX_BATCH_CHARS) await flush();
      batch.push(e);
      size += len;
    }
    await flush();
    return { sent };

    // Une ligne modifiée pendant l'envoi garde son marqueur : elle repartira au prochain envoi.
    async function acknowledge(done: Entry[]) {
      await syncTransaction(db, async () => {
        for (const e of done) {
          if (e.tbl === 'deletion') { await db.tombstones.delete(e.id); continue; }
          const table = db.table(e.tbl);
          const current = await table.get(e.local.id!) as Row | undefined;
          if (current && current.updatedAt === e.local.updatedAt) await table.update(e.local.id!, { dirty: 0 });
        }
      });
    }
  }

  // ── Réception ─────────────────────────────────────────────
  async function pull(): Promise<Omit<SyncResult, 'sent'>> {
    const since = Number(storage.getItem(REVISION_KEY) ?? 0) || 0;
    const data = await request<SyncPullResponse>(
      `/sync/pull?since=${since}&clientId=${encodeURIComponent(clientId())}`
    );

    let received = 0;
    let overridden = 0;
    let orphans = 0;

    await syncTransaction(db, async () => {
      const now = new Date().toISOString();

      // Applique une ligne reçue, sauf si la version locale non envoyée est plus récente.
      async function upsert<T extends Row>(tbl: SyncTable, byUid: Map<string, T>, row: T & { uid: string; updatedAt: string }) {
        const local = byUid.get(row.uid);
        if (local?.dirty && (local.updatedAt ?? '') > row.updatedAt) return local.id;
        if (local) overridden += local.dirty ? 1 : 0;
        const value = { ...row, id: local?.id, dirty: 0 } as T;
        if (local?.id == null) delete value.id;
        const id = await db.table(tbl).put(value) as number;
        byUid.set(row.uid, { ...value, id });
        received++;
        return id;
      }

      const index = async <T extends Row>(tbl: SyncTable) =>
        new Map((await db.table(tbl).toArray() as T[]).filter(r => r.uid).map(r => [r.uid!, r]));

      const products = await index<Product>('products');
      const bons     = await index<Bon>('bons');
      for (const p of data.products) await upsert('products', products, p as Product & SyncProduct);
      for (const b of data.bons)     await upsert('bons', bons, b as Bon & SyncBon);

      const productId = (uid: string) => products.get(uid)?.id;
      const bonId     = (uid: string | null) => (uid ? bons.get(uid)?.id : undefined);

      const movements = await index<Movement>('movements');
      for (const { productUid, bonUid, ...m } of data.movements) {
        const pid = productId(productUid);
        if (pid == null) { orphans++; continue; }
        const row = { ...m, productId: pid, bonId: bonId(bonUid) } as Movement & { uid: string; updatedAt: string };
        if (row.bonId == null) delete row.bonId;
        await upsert('movements', movements, row);
      }

      const items = await index<BonItem>('bonItems');
      for (const { productUid, bonUid, ...i } of data.bonItems) {
        const pid = productId(productUid);
        const bid = bonId(bonUid);
        if (pid == null || bid == null) { orphans++; continue; }
        await upsert('bonItems', items, { ...i, productId: pid, bonId: bid } as BonItem & { uid: string; updatedAt: string });
      }

      // Suppression locale d'une ligne, sauf si elle a été modifiée ici depuis, ou si c'est
      // un produit encore utilisé sur ce poste : il est alors renvoyé au serveur (ressuscité).
      async function remove(tbl: SyncTable, row: Row, deletedAt: string) {
        if (row.dirty && (row.updatedAt ?? '') > deletedAt) return;
        if (tbl === 'products') {
          const used = await db.movements.where('productId').equals(row.id!).count()
                     + await db.bonItems.where('productId').equals(row.id!).count();
          if (used > 0) { await db.products.update(row.id!, { dirty: 1, updatedAt: now }); return; }
        }
        await db.table(tbl).delete(row.id!);
      }

      // Enfants d'abord, pour que le contrôle d'usage des produits soit juste.
      const order: SyncTable[] = ['bonItems', 'movements', 'bons', 'products'];
      const byTable = { products, bons, movements, bonItems: items } as Record<SyncTable, Map<string, Row>>;
      for (const tbl of order) {
        for (const d of data.deletions.filter(x => x.tbl === tbl)) {
          const local = byTable[tbl].get(d.uid);
          if (local) await remove(tbl, local, d.deletedAt);
        }
        // Réception complète : ce qui n'est pas sur le serveur (et pas modifié ici) a été supprimé ailleurs.
        if (data.full) {
          const present = new Set((data[tbl] as { uid: string }[]).map(r => r.uid));
          for (const [uid, local] of byTable[tbl]) {
            if (!present.has(uid) && !local.dirty) await remove(tbl, local, now);
          }
        }
      }
    });

    storage.setItem(REVISION_KEY, String(data.revision));
    return { received, overridden, orphans };
  }

  return {
    // Envoie les modifications locales puis reçoit celles des autres postes.
    async sync(): Promise<SyncResult> {
      const { sent } = await push();
      const pulled = await pull();
      storage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { sent, ...pulled };
    },

    // Nombre de modifications locales en attente d'envoi.
    async pendingCount(): Promise<number> {
      const counts = await Promise.all([
        db.products.where('dirty').equals(1).count(),
        db.movements.where('dirty').equals(1).count(),
        db.bons.where('dirty').equals(1).count(),
        db.bonItems.where('dirty').equals(1).count(),
        db.tombstones.count(),
      ]);
      return counts.reduce((a, b) => a + b, 0);
    },

    lastSyncDate(): Date | null {
      const raw = storage.getItem(LAST_SYNC_KEY);
      return raw ? new Date(raw) : null;
    },
  };
}

export type SyncClient = ReturnType<typeof createSyncClient>;

export const syncClient = createSyncClient({
  database: appDb,
  apiBase: API_BASE,
  getToken: () => localStorage.getItem('stock_auth_token'),
  // globalThis : évite une erreur à l'import hors navigateur (tests).
  storage: globalThis.localStorage,
});

export async function checkServer(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/status`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}
