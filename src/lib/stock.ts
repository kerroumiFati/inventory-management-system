import type { Movement, Product } from '../../shared/schemas';

// Fonctions pures de calcul de stock, partagées par toutes les pages.
// Aucune dépendance à Dexie — testables isolément (voir tests/stock-calculation.test.ts).

const METER_UNITS = ['m', 'm²', 'm³', 'mètre', 'mètre linéaire'];

// Unités pour lesquelles on autorise les quantités décimales.
export function isMeterUnit(unit: string | undefined): boolean {
  return !!unit && METER_UNITS.includes(unit);
}

export function quantityStep(unit: string | undefined): string {
  return isMeterUnit(unit) ? '0.001' : '1';
}

// Arrondit les erreurs de virgule flottante (0.1 + 0.2) avant affichage.
export function formatQty(val: number, unit?: string): string {
  const n = parseFloat(val.toFixed(3));
  return `${n} ${unit || ''}`.trim();
}

// Quantité nette des mouvements par produit (entrées − sorties).
export function netMovementsByProduct(
  movements: Pick<Movement, 'productId' | 'type' | 'quantity'>[]
): Map<number, number> {
  const map = new Map<number, number>();
  for (const m of movements) {
    const q = Number(m.quantity) || 0;
    map.set(m.productId, (map.get(m.productId) ?? 0) + (m.type === 'entree' ? q : -q));
  }
  return map;
}

export type StockStatus = 'ok' | 'low' | 'empty';

// Règle unique : épuisé si ≤ 0, faible si ≤ seuil (seuil > 0), sinon OK.
export function stockStatus(qty: number, minStock: number | undefined): StockStatus {
  if (qty <= 0) return 'empty';
  const min = Number(minStock) || 0;
  if (min > 0 && qty <= min) return 'low';
  return 'ok';
}

export interface StockLevel extends Product {
  qty: number;
  used: number;
  status: StockStatus;
  // Valeur du stock au prix unitaire actuel (un stock négatif ne vaut rien).
  value: number;
}

// Niveau de stock de chaque produit : stock initial + mouvements.
export function computeStockLevels(
  products: Product[],
  movements: Pick<Movement, 'productId' | 'type' | 'quantity'>[]
): StockLevel[] {
  const net  = netMovementsByProduct(movements);
  const used = new Map<number, number>();
  for (const m of movements) {
    if (m.type === 'sortie') used.set(m.productId, (used.get(m.productId) ?? 0) + (Number(m.quantity) || 0));
  }
  return products.map(p => {
    const qty = (Number(p.stockInitial) || 0) + (p.id != null ? net.get(p.id) ?? 0 : 0);
    return {
      ...p, qty, used: p.id != null ? used.get(p.id) ?? 0 : 0, status: stockStatus(qty, p.minStock),
      value: Math.max(0, qty) * (Number(p.unitPrice) || 0),
    };
  });
}

// Préfixe des numéros de bon : STK pour les sorties (historique), REC réceptions,
// CMD commandes fournisseur, INV inventaires.
const BON_PREFIXES: Record<string, string> = { entree: 'REC', commande: 'CMD', inventaire: 'INV' };

export function bonPrefix(type: string | undefined): string {
  return (type && BON_PREFIXES[type]) || 'STK';
}

// Prochain numéro de bon de l'année : max existant + 1.
// (Basé sur le max et non sur le nombre de bons : après une suppression,
// un comptage produirait un numéro déjà attribué.)
export function nextBonNumber(existingNumbers: string[], year: number, type: string = 'sortie'): string {
  const prefix = `${bonPrefix(type)}-${year}-`;
  let max = 0;
  for (const n of existingNumbers) {
    if (!n?.startsWith(prefix)) continue;
    const seq = parseInt(n.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// Numéros attribués à plusieurs bons (possible quand deux postes hors-ligne créent un bon
// en même temps : chacun calcule le même « prochain numéro »).
export function duplicateBonNumbers(bons: { number: string; type?: string }[]): Set<string> {
  const seen = new Set<string>();
  const dup  = new Set<string>();
  for (const b of bons) {
    if (seen.has(b.number)) dup.add(b.number);
    seen.add(b.number);
  }
  return dup;
}

// Stock initial à enregistrer pour qu'un produit existant affiche `targetQty`
// compte tenu des mouvements déjà enregistrés (utilisé par l'import Excel :
// la colonne « Q. Actuel » est le stock réel, pas le stock initial).
export function stockInitialForTarget(targetQty: number, netMovements: number): number {
  return parseFloat((targetQty - netMovements).toFixed(3));
}

// Convertit une cellule Excel en nombre, en acceptant la virgule décimale française.
export function parseNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Montant avec deux décimales (séparateurs français). La devise, facultative, vient de VITE_CURRENCY.
export function formatMoney(value: number, currency = ''): string {
  const n = (Number(value) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${n} ${currency}` : n;
}

// ── Commandes fournisseur ─────────────────────────────────────

type ProductQty = { productId: number; quantity: number };

export type OrderStatus = 'ouverte' | 'partielle' | 'recue';

export interface OrderLineProgress {
  productId: number;
  ordered: number;
  received: number;
  remaining: number;
}

// Avancement d'une commande : quantités commandées, reçues (réceptions liées), restant à recevoir.
export function orderProgress(ordered: ProductQty[], received: ProductQty[]): { lines: OrderLineProgress[]; status: OrderStatus } {
  const receivedBy = new Map<number, number>();
  for (const r of received) receivedBy.set(r.productId, (receivedBy.get(r.productId) ?? 0) + (Number(r.quantity) || 0));
  const orderedBy = new Map<number, number>();
  for (const o of ordered) orderedBy.set(o.productId, (orderedBy.get(o.productId) ?? 0) + (Number(o.quantity) || 0));

  const lines = [...orderedBy].map(([productId, qty]) => {
    const got = receivedBy.get(productId) ?? 0;
    return { productId, ordered: qty, received: got, remaining: Math.max(0, parseFloat((qty - got).toFixed(3))) };
  });
  const anyReceived = [...receivedBy.values()].some(q => q > 0);
  const status: OrderStatus = lines.every(l => l.remaining <= 0) && lines.length
    ? 'recue'
    : anyReceived ? 'partielle' : 'ouverte';
  return { lines, status };
}

type BonLike = { id?: number; uid?: string; type?: string; orderUid?: string | null };
type BonItemLike = { bonId: number; productId: number; quantity: number };

export interface OrderInfo<B extends BonLike> {
  order: B;
  receptions: B[];
  lines: OrderLineProgress[];
  status: OrderStatus;
}

// Commandes avec leurs réceptions liées et leur avancement.
export function ordersWithProgress<B extends BonLike>(bons: B[], items: BonItemLike[]): OrderInfo<B>[] {
  const itemsByBon = new Map<number, BonItemLike[]>();
  for (const i of items) {
    const list = itemsByBon.get(i.bonId);
    if (list) list.push(i); else itemsByBon.set(i.bonId, [i]);
  }
  const receptionsByOrder = new Map<string, B[]>();
  for (const b of bons) {
    if (b.type !== 'entree' || !b.orderUid) continue;
    const list = receptionsByOrder.get(b.orderUid);
    if (list) list.push(b); else receptionsByOrder.set(b.orderUid, [b]);
  }
  return bons.filter(b => b.type === 'commande').map(order => {
    const receptions = (order.uid && receptionsByOrder.get(order.uid)) || [];
    const received = receptions.flatMap(r => (r.id != null && itemsByBon.get(r.id)) || []);
    const { lines, status } = orderProgress((order.id != null && itemsByBon.get(order.id)) || [], received);
    return { order, receptions, lines, status };
  });
}

// Quantités commandées et pas encore reçues, par produit.
export function quantitiesOnOrder(orders: { lines: OrderLineProgress[]; status: OrderStatus }[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const o of orders) {
    if (o.status === 'recue') continue;
    for (const l of o.lines) if (l.remaining > 0) map.set(l.productId, (map.get(l.productId) ?? 0) + l.remaining);
  }
  return map;
}

export interface ReorderSuggestion {
  product: StockLevel;
  // Quantité déjà commandée et pas encore reçue.
  onOrder: number;
  target: number;
  suggested: number;
}

// Produits à réapprovisionner : stock (commandes en cours comprises) au niveau du minimum ou en dessous.
// Quantité proposée : de quoi remonter au stock cible (par défaut deux fois le minimum).
export function reorderSuggestions(levels: StockLevel[], onOrder: Map<number, number>): ReorderSuggestion[] {
  const out: ReorderSuggestion[] = [];
  for (const p of levels) {
    const min = Number(p.minStock) || 0;
    const target = Number(p.maxStock) > 0 ? Number(p.maxStock) : min * 2;
    if (target <= 0) continue;
    const pending = p.id != null ? onOrder.get(p.id) ?? 0 : 0;
    const below = min > 0 ? p.qty <= min : p.qty <= 0;
    if (!below) continue;
    let suggested = Math.max(0, target - p.qty - pending);
    suggested = isMeterUnit(p.unit) ? parseFloat(suggested.toFixed(3)) : Math.ceil(suggested);
    out.push({ product: p, onOrder: pending, target, suggested });
  }
  return out.sort((a, b) => (a.product.supplier || '').localeCompare(b.product.supplier || '') || a.product.name.localeCompare(b.product.name));
}

// ── Inventaire ────────────────────────────────────────────────

export interface InventoryLine {
  productId: number;
  expected: number;
  counted: number;
  // Écart compté − théorique (positif : surplus, négatif : manquant).
  diff: number;
  // Valeur de l'écart au prix unitaire actuel.
  diffValue: number;
}

// Lignes d'inventaire pour les produits comptés (un produit non compté n'est pas ajusté).
export function inventoryLines(levels: StockLevel[], counts: Record<string, number | string>): InventoryLine[] {
  const lines: InventoryLine[] = [];
  for (const p of levels) {
    if (p.id == null) continue;
    const raw = counts[String(p.id)];
    if (raw === undefined || raw === '' || !Number.isFinite(Number(raw))) continue;
    const counted = Number(raw);
    const diff = parseFloat((counted - p.qty).toFixed(3));
    lines.push({ productId: p.id, expected: p.qty, counted, diff, diffValue: diff * (Number(p.unitPrice) || 0) });
  }
  return lines;
}
