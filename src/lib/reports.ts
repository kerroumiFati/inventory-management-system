import type { Bon, Movement, Product } from '../../shared/schemas';
import type { StockLevel } from './stock';

// Calculs des rapports (fonctions pures, testées dans tests/reports.test.ts).
// Les montants sont valorisés au prix unitaire actuel des produits.

export interface Period {
  from: string; // AAAA-MM-JJ inclus
  to: string;   // AAAA-MM-JJ inclus
}

// Date ISO → jour local AAAA-MM-JJ (les dates enregistrées sont en UTC).
export function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function inPeriod(iso: string, { from, to }: Period): boolean {
  const day = localDay(iso);
  return day >= from && day <= to;
}

type MovementLike = Pick<Movement, 'productId' | 'type' | 'quantity' | 'date' | 'bonId'>;
type BonLike = Pick<Bon, 'id' | 'type' | 'destination'>;
type ProductLike = Pick<Product, 'id' | 'unitPrice'>;

// Les ajustements d'inventaire ne sont ni des consommations ni des achats.
function isAdjustment(m: MovementLike, bonsById: Map<number, BonLike>): boolean {
  return m.bonId != null && bonsById.get(m.bonId)?.type === 'inventaire';
}

export interface ProductFlow {
  productId: number;
  quantity: number;
  value: number;
  count: number;
}

// Sorties (ou entrées) de la période, cumulées par produit, de la plus forte valeur à la plus faible.
export function flowsByProduct(
  type: 'sortie' | 'entree',
  movements: MovementLike[],
  bons: BonLike[],
  products: ProductLike[],
  period: Period,
): ProductFlow[] {
  const bonsById = new Map(bons.filter(b => b.id != null).map(b => [b.id!, b]));
  const price = new Map(products.filter(p => p.id != null).map(p => [p.id!, Number(p.unitPrice) || 0]));
  const by = new Map<number, ProductFlow>();
  for (const m of movements) {
    if (m.type !== type || !inPeriod(m.date, period) || isAdjustment(m, bonsById)) continue;
    const row = by.get(m.productId) ?? { productId: m.productId, quantity: 0, value: 0, count: 0 };
    const q = Number(m.quantity) || 0;
    row.quantity += q;
    row.value += q * (price.get(m.productId) ?? 0);
    row.count++;
    by.set(m.productId, row);
  }
  return [...by.values()].sort((a, b) => b.value - a.value || b.quantity - a.quantity);
}

export interface DestinationFlow {
  destination: string;
  bons: number;
  value: number;
}

// Consommation par destination (bons de sortie de la période).
export function consumptionByDestination(
  movements: MovementLike[],
  bons: BonLike[],
  products: ProductLike[],
  period: Period,
): DestinationFlow[] {
  const bonsById = new Map(bons.filter(b => b.id != null).map(b => [b.id!, b]));
  const price = new Map(products.filter(p => p.id != null).map(p => [p.id!, Number(p.unitPrice) || 0]));
  const by = new Map<string, { bonIds: Set<number>; value: number }>();
  for (const m of movements) {
    if (m.type !== 'sortie' || !inPeriod(m.date, period) || isAdjustment(m, bonsById)) continue;
    const bon = m.bonId != null ? bonsById.get(m.bonId) : undefined;
    const destination = bon?.destination?.trim() || '(non précisée)';
    const row = by.get(destination) ?? { bonIds: new Set<number>(), value: 0 };
    if (m.bonId != null) row.bonIds.add(m.bonId);
    row.value += (Number(m.quantity) || 0) * (price.get(m.productId) ?? 0);
    by.set(destination, row);
  }
  return [...by].map(([destination, r]) => ({ destination, bons: r.bonIds.size, value: r.value }))
    .sort((a, b) => b.value - a.value || b.bons - a.bons);
}

export interface DormantProduct {
  product: StockLevel;
  lastMovement: string | null;
}

// Produits en stock sans aucun mouvement depuis `days` jours (stock immobilisé).
export function dormantProducts(levels: StockLevel[], movements: MovementLike[], days: number, now = new Date()): DormantProduct[] {
  const last = new Map<number, string>();
  for (const m of movements) {
    const prev = last.get(m.productId);
    if (!prev || m.date > prev) last.set(m.productId, m.date);
  }
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return levels
    .filter(p => p.qty > 0 && p.id != null && (last.get(p.id) ?? '') < cutoff)
    .map(p => ({ product: p, lastMovement: last.get(p.id!) ?? null }))
    .sort((a, b) => b.product.value - a.product.value || (a.lastMovement ?? '').localeCompare(b.lastMovement ?? ''));
}

// Périodes proposées par défaut.
export function periodPresets(now = new Date()): { key: string; label: string; period: Period }[] {
  const day = (d: Date) => localDay(d.toISOString());
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { key: 'month',     label: 'Ce mois',        period: { from: day(new Date(y, m, 1)),     to: day(now) } },
    { key: 'lastMonth', label: 'Mois précédent', period: { from: day(new Date(y, m - 1, 1)), to: day(new Date(y, m, 0)) } },
    { key: '30d',       label: '30 derniers jours', period: { from: day(new Date(now.getTime() - 29 * 86_400_000)), to: day(now) } },
    { key: 'year',      label: 'Cette année',    period: { from: day(new Date(y, 0, 1)),     to: day(now) } },
  ];
}
