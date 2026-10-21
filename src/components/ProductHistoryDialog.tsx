import { useLiveQuery } from 'dexie-react-hooks';
import { History, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { db } from '../db';
import { formatQty } from '@/lib/stock';
import type { NavigateFn } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ProductHistoryDialogProps {
  productId: number | null;
  onClose: () => void;
  navigate: NavigateFn;
}

// Historique des mouvements d'un produit, du plus récent au plus ancien,
// avec le stock obtenu après chaque mouvement.
export default function ProductHistoryDialog({ productId, onClose, navigate }: ProductHistoryDialogProps) {
  const data = useLiveQuery(async () => {
    if (productId == null) return null;
    const [product, movements] = await Promise.all([
      db.products.get(productId),
      db.movements.where('productId').equals(productId).sortBy('date'),
    ]);
    if (!product) return null;
    let balance = Number(product.stockInitial) || 0;
    const rows = movements.map(m => {
      balance += m.type === 'entree' ? m.quantity : -m.quantity;
      return { ...m, balance };
    }).reverse();
    return { product, rows };
  }, [productId]);

  const product = data?.product;

  return (
    <Dialog open={productId != null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="min-w-0 pr-8">
            <DialogTitle className="flex items-center gap-2"><History size={16} /> Historique</DialogTitle>
            {product && (
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {product.reference ? `[${product.reference}] ` : ''}{product.name} — stock initial : {formatQty(Number(product.stockInitial) || 0, product.unit)}
              </p>
            )}
          </div>
        </DialogHeader>

        <div className="overflow-y-auto">
          {data?.rows.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">Aucun mouvement pour ce produit.</p>
          )}
          {!!data?.rows.length && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="text-left font-semibold px-4 py-2">Date</th>
                  <th className="text-right font-semibold px-2 py-2">Mouvement</th>
                  <th className="text-right font-semibold px-2 py-2">Stock après</th>
                  <th className="text-left font-semibold px-2 py-2">Bon / Note</th>
                  <th className="text-left font-semibold px-4 py-2">Par</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(m => {
                  const entree = m.type === 'entree';
                  return (
                    <tr key={m.id} className="border-b border-slate-50">
                      <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                        {new Date(m.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className={`px-2 py-2 text-right font-semibold whitespace-nowrap ${entree ? 'text-emerald-600' : 'text-amber-600'}`}>
                        <span className="inline-flex items-center gap-1">
                          {entree ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                          {entree ? '+' : '−'}{formatQty(m.quantity, product?.unit)}
                        </span>
                      </td>
                      <td className={`px-2 py-2 text-right whitespace-nowrap ${m.balance < 0 ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                        {formatQty(m.balance, product?.unit)}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {m.bonId != null && m.bonNumber ? (
                          <button
                            onClick={() => { onClose(); navigate('bon-detail', { bonId: m.bonId }); }}
                            className="font-mono text-indigo-600 hover:underline"
                          >
                            {m.bonNumber}
                          </button>
                        ) : m.bonNumber ? (
                          <span className="font-mono text-slate-500">{m.bonNumber}</span>
                        ) : null}
                        {m.note && <div className="text-slate-400 italic truncate max-w-[200px]">{m.note}</div>}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{m.createdBy || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
