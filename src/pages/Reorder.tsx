import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
  computeStockLevels, formatMoney, formatQty, ordersWithProgress, quantitiesOnOrder, quantityStep,
  reorderSuggestions,
} from '@/lib/stock';
import { ORDER_STATUS } from '@/lib/bons';
import { receptionDraft, replaceDraft } from '@/lib/drafts';
import { ShoppingCart, Plus, PackageCheck, ChevronRight, CheckCircle } from 'lucide-react';
import type { NavigateFn } from '../types';
import { CURRENCY } from '../config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

const NO_SUPPLIER = 'Sans fournisseur';

export default function Reorder({ navigate }: { navigate: NavigateFn }) {
  const data = useLiveQuery(async () => {
    const [products, movements, bons, items] = await Promise.all([
      db.products.toArray(), db.movements.toArray(), db.bons.toArray(), db.bonItems.toArray(),
    ]);
    const orders = ordersWithProgress(bons, items);
    const levels = computeStockLevels(products, movements);
    return { levels, orders, suggestions: reorderSuggestions(levels, quantitiesOnOrder(orders)) };
  }, []);

  // Quantités modifiées et lignes décochées par l'utilisateur (sinon : proposition calculée).
  const [qtyEdits, setQtyEdits] = useState<Record<number, string>>({});
  const [unchecked, setUnchecked] = useState<Record<number, boolean>>({});

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>['suggestions']>();
    for (const s of data?.suggestions ?? []) {
      const key = s.product.supplier?.trim() || NO_SUPPLIER;
      const list = map.get(key);
      if (list) list.push(s); else map.set(key, [s]);
    }
    // « Sans fournisseur » en dernier.
    return [...map].sort(([a], [b]) => (a === NO_SUPPLIER ? 1 : b === NO_SUPPLIER ? -1 : a.localeCompare(b)));
  }, [data]);

  const openOrders = (data?.orders ?? [])
    .filter(o => o.status !== 'recue')
    .sort((a, b) => b.order.date.localeCompare(a.order.date));
  const productName = (id: number) => data?.levels.find(p => p.id === id)?.name ?? `#${id}`;

  const qtyOf = (productId: number, suggested: number) => qtyEdits[productId] ?? String(suggested);
  const isChecked = (productId: number, suggested: number) => unchecked[productId] === undefined ? suggested > 0 : !unchecked[productId];

  function prepareOrder(supplier: string, rows: NonNullable<typeof data>['suggestions']) {
    const items = rows
      .filter(r => r.product.id != null && isChecked(r.product.id, r.suggested) && Number(qtyOf(r.product.id, r.suggested)) > 0)
      .map(r => ({ productId: String(r.product.id), quantity: qtyOf(r.product.id!, r.suggested), note: '' }));
    if (!items.length) return;
    const ok = replaceDraft('commande', {
      destination: supplier === NO_SUPPLIER ? '' : supplier, note: '', items, preparedBy: 'reappro',
    });
    if (ok) navigate('commande');
  }

  function receive(o: (typeof openOrders)[number]) {
    if (replaceDraft('entree', receptionDraft(o.order, o.lines))) navigate('entree');
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Réapprovisionnement</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Produits au minimum ou en dessous, commandes en cours déduites. Quantité proposée : jusqu'au stock cible
            (fiche produit) ou, à défaut, deux fois le minimum.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('commande')}>
          <Plus size={15} /> Commande libre
        </Button>
      </div>

      {/* Propositions */}
      {data && !groups.length && (
        <Card className="p-8 text-center mb-6">
          <CheckCircle size={32} className="mx-auto mb-3 text-emerald-300" />
          <p className="text-sm font-semibold text-slate-700">Rien à commander</p>
          <p className="text-xs text-slate-400 mt-1">
            Aucun produit n'est sous son minimum. Renseignez un stock minimum dans les fiches produits pour être alerté.
          </p>
        </Card>
      )}

      <div className="space-y-4 mb-8">
        {groups.map(([supplier, rows]) => {
          const selected = rows.filter(r => r.product.id != null && isChecked(r.product.id, r.suggested));
          const total = selected.reduce((s, r) => s + (Number(qtyOf(r.product.id!, r.suggested)) || 0) * (Number(r.product.unitPrice) || 0), 0);
          return (
            <Card key={supplier} className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 flex-wrap">
                <div className="flex items-center gap-2 font-semibold text-slate-800 text-sm">
                  <ShoppingCart size={15} className="text-indigo-500" /> {supplier}
                  <span className="text-xs font-normal text-slate-400">{rows.length} produit(s)</span>
                </div>
                <div className="flex items-center gap-3">
                  {total > 0 && <span className="text-xs text-slate-500">Montant estimé : <span className="font-semibold">{formatMoney(total, CURRENCY)}</span></span>}
                  <Button size="sm" onClick={() => prepareOrder(supplier, rows)} disabled={!selected.length}>
                    Préparer la commande ({selected.length})
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                {/* Largeurs fixes : les colonnes restent alignées d'un fournisseur à l'autre. */}
                <table className="w-full text-sm table-fixed min-w-[640px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-50">
                      <th className="w-10 px-3 py-2" />
                      <th className="text-left font-semibold px-2 py-2">Produit</th>
                      <th className="text-right font-semibold px-2 py-2 w-28">Stock</th>
                      <th className="text-right font-semibold px-2 py-2 w-28">Min / cible</th>
                      <th className="text-right font-semibold px-2 py-2 w-28">En commande</th>
                      <th className="text-left font-semibold px-4 py-2 w-44">À commander</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const p = r.product;
                      const id = p.id!;
                      return (
                        <tr key={id} className="border-b border-slate-50">
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked(id, r.suggested)}
                              onChange={e => setUnchecked(u => ({ ...u, [id]: !e.target.checked }))}
                              aria-label={`Commander ${p.name}`}
                              className="accent-indigo-600"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-slate-800">{p.name}</div>
                            {p.reference && <div className="text-xs text-slate-400">{p.reference}</div>}
                          </td>
                          <td className={`px-2 py-2 text-right font-semibold whitespace-nowrap ${p.qty <= 0 ? 'text-red-600' : 'text-amber-600'}`}>
                            {formatQty(p.qty, p.unit)}
                          </td>
                          <td className="px-2 py-2 text-right text-slate-500 whitespace-nowrap">
                            {formatQty(Number(p.minStock) || 0)} / {formatQty(r.target)}
                          </td>
                          <td className="px-2 py-2 text-right text-slate-500 whitespace-nowrap">
                            {r.onOrder > 0 ? formatQty(r.onOrder, p.unit) : '—'}
                          </td>
                          <td className="px-4 py-2">
                            {r.suggested === 0 && qtyEdits[id] === undefined ? (
                              <span className="text-xs text-emerald-700">Couvert par les commandes</span>
                            ) : (
                              <Input
                                type="number" min="0" step={quantityStep(p.unit)}
                                value={qtyOf(id, r.suggested)}
                                onChange={e => setQtyEdits(q => ({ ...q, [id]: e.target.value }))}
                                className="h-8 w-28"
                                aria-label={`Quantité à commander pour ${p.name}`}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Commandes en cours */}
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Commandes en cours</h2>
      {!openOrders.length ? (
        <Card className="p-6 text-center text-sm text-slate-400">Aucune commande en attente de réception.</Card>
      ) : (
        <div className="space-y-2">
          {openOrders.map(o => {
            const remaining = o.lines.filter(l => l.remaining > 0);
            return (
              <Card key={o.order.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => navigate('bon-detail', { bonId: o.order.id })} className="font-semibold text-sm text-indigo-600 hover:underline">
                      {o.order.number}
                    </button>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${ORDER_STATUS[o.status].className}`}>
                      {ORDER_STATUS[o.status].label}
                    </span>
                    <span className="text-xs text-slate-400">{new Date(o.order.date).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{o.order.destination || 'Fournisseur non précisé'}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate">
                    Reste : {remaining.slice(0, 3).map(l => `${productName(l.productId)} × ${formatQty(l.remaining)}`).join(', ')}
                    {remaining.length > 3 && ` +${remaining.length - 3}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => receive(o)}>
                    <PackageCheck size={14} /> Réceptionner
                  </Button>
                  <button onClick={() => navigate('bon-detail', { bonId: o.order.id })} className="text-slate-300 hover:text-slate-500" aria-label={`Ouvrir ${o.order.number}`}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
