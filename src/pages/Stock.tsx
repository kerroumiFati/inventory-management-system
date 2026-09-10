import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createColumnHelper,
  flexRender,
  useTable,
} from '@tanstack/react-table';
import { db, getProductByBarcode } from '../db';
import { ArrowUpCircle, Check, BarChart2, ScanLine, Search, ArrowUpDown } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';
import type { Product } from '../../shared/schemas';
import { sortableTableFeatures } from '@/lib/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface StockRow extends Product {
  qty: number;
  qteUtilisee: number;
}

type FilterKey = 'all' | 'low' | 'empty';

const isMeter = (u: string | undefined) => !!u && ['m', 'm²', 'm³', 'mètre linéaire'].includes(u);

function fmt(val: number, unit: string | undefined) {
  if (isMeter(unit)) return `${parseFloat(val.toFixed(3))} ${unit}`;
  return `${val} ${unit || ''}`.trim();
}

const columnHelper = createColumnHelper<typeof sortableTableFeatures, StockRow>();

export default function Stock() {
  const [addModal, setAddModal] = useState<StockRow | null>(null);
  const [scanner,  setScanner]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState<FilterKey>('all');

  const stockData = useLiveQuery(async () => {
    const prods = await db.products.toArray();
    const mvts  = await db.movements.toArray();
    const map: Record<number, StockRow> = {};
    prods.forEach(p => { if (p.id != null) map[p.id] = { ...p, qty: Number(p.stockInitial) || 0, qteUtilisee: 0 }; });
    mvts.forEach(m => {
      if (!map[m.productId]) return;
      const qty = Number(m.quantity);
      if (m.type === 'entree') map[m.productId].qty += qty;
      else { map[m.productId].qty -= qty; map[m.productId].qteUtilisee += qty; }
    });
    return Object.values(map);
  }, []);

  const displayed = useMemo(() => {
    if (!stockData) return [];
    let list = stockData;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.reference || '').toLowerCase().includes(q) ||
        (p.category  || '').toLowerCase().includes(q)
      );
    }
    if (filter === 'low')   list = list.filter(p => p.minStock > 0 && p.qty > 0 && p.qty <= p.minStock);
    if (filter === 'empty') list = list.filter(p => p.qty <= 0);
    return list;
  }, [stockData, search, filter]);

  const lowCount   = stockData?.filter(p => p.minStock > 0 && p.qty > 0 && p.qty <= p.minStock).length ?? 0;
  const emptyCount = stockData?.filter(p => p.qty <= 0).length ?? 0;

  async function saveEntree(productId: number, qty: string, note: string) {
    await db.movements.add({
      productId: Number(productId),
      type: 'entree',
      date: new Date().toISOString(),
      quantity: Number(qty),
      bonNumber: '',
      note,
    });
    setAddModal(null);
  }

  async function handleScan(code: string) {
    setScanner(false);
    const found = await getProductByBarcode(code);
    if (found) {
      const p = stockData?.find(s => s.id === found.id);
      if (p) setAddModal(p);
    } else {
      alert(`Produit introuvable pour le code : ${code}`);
    }
  }

  const FILTERS: { key: FilterKey; label: string; count: number; warn?: boolean; danger?: boolean }[] = [
    { key: 'all',   label: 'Tous',         count: stockData?.length ?? 0 },
    { key: 'low',   label: 'Stock faible', count: lowCount,   warn: true },
    { key: 'empty', label: 'Épuisé',       count: emptyCount, danger: true },
  ];

  const columns = useMemo(() => columnHelper.columns([
    columnHelper.accessor('name', {
      header: 'Produit',
      cell: ctx => {
        const p = ctx.row.original;
        const min = Number(p.minStock) || 0;
        const isEmpty = p.qty <= 0;
        const isLow = min > 0 && p.qty > 0 && p.qty <= min;
        const max = Math.max(p.qty, min * 2, 1);
        const pct = Math.min(100, Math.max(0, (p.qty / max) * 100));
        const color = isEmpty ? '#dc2626' : isLow ? '#d97706' : '#10b981';
        return (
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800">{p.name}</span>
              {p.reference && <span className="text-xs font-mono text-slate-400">{p.reference}</span>}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-slate-100">
                <div className="h-full rounded-full transition-all" style={{ width: `${isEmpty ? 0 : pct}%`, background: color }} />
              </div>
              {p.qteUtilisee > 0 && (
                <span className="text-[10px] text-slate-400 shrink-0">{fmt(p.qteUtilisee, p.unit)} utilisé</span>
              )}
            </div>
          </div>
        );
      },
    }),
    columnHelper.accessor('category', {
      header: 'Famille',
      cell: ctx => ctx.getValue()
        ? <div className="text-center"><Badge>{ctx.getValue()}</Badge></div>
        : <div className="text-center text-xs text-slate-300">—</div>,
    }),
    columnHelper.accessor('qty', {
      header: ({ column }) => (
        <button className="flex items-center gap-1 mx-auto hover:text-slate-600" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Stock actuel <ArrowUpDown size={11} />
        </button>
      ),
      cell: ctx => {
        const p = ctx.row.original;
        const min = Number(p.minStock) || 0;
        const isEmpty = p.qty <= 0;
        const isLow = min > 0 && p.qty > 0 && p.qty <= min;
        const color = isEmpty ? '#dc2626' : isLow ? '#d97706' : '#10b981';
        return <div className="text-center text-base font-bold" style={{ color }}>{fmt(p.qty, p.unit)}</div>;
      },
    }),
    columnHelper.accessor('minStock', {
      header: ({ column }) => (
        <button className="flex items-center gap-1 mx-auto hover:text-slate-600" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Minimum <ArrowUpDown size={11} />
        </button>
      ),
      cell: ctx => {
        const p = ctx.row.original;
        const min = Number(p.minStock) || 0;
        return <div className="text-center text-sm text-slate-400">{min > 0 ? fmt(min, p.unit) : '—'}</div>;
      },
    }),
    columnHelper.display({
      id: 'actions',
      cell: ctx => {
        const p = ctx.row.original;
        const min = Number(p.minStock) || 0;
        const isEmpty = p.qty <= 0;
        const isLow = min > 0 && p.qty > 0 && p.qty <= min;
        const statusColor = isEmpty ? '#dc2626' : isLow ? '#d97706' : '#10b981';
        const statusBg    = isEmpty ? '#fee2e2' : isLow ? '#fef3c7' : '#d1fae5';
        const statusLabel = isEmpty ? 'Épuisé' : isLow ? 'Faible' : 'OK';
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ background: statusBg, color: statusColor }}>
              {statusLabel}
            </span>
            <Button
              onClick={() => setAddModal(p)}
              size="sm"
              className="h-7 px-2.5 text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-100 hover:opacity-80"
            >
              <ArrowUpCircle size={12} /> Entrée
            </Button>
          </div>
        );
      },
    }),
  ]), []);

  const table = useTable({
    features: sortableTableFeatures,
    data: displayed,
    columns,
  });

  return (
    <div>
      {scanner  && <BarcodeScanner onScan={handleScan} onClose={() => setScanner(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Niveaux de stock</h1>
          <p className="text-sm text-slate-500 mt-0.5">{stockData?.length ?? 0} produit(s)</p>
        </div>
        <Button variant="outline" onClick={() => setScanner(true)}>
          <ScanLine size={16} /> Scanner
        </Button>
      </div>

      {/* Barre de recherche + filtres */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <Input
            placeholder="Rechercher libellé, référence, famille..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 p-1 rounded-xl border border-slate-100 bg-white">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={filter === f.key
                ? { background: f.danger ? '#fee2e2' : f.warn ? '#fef3c7' : '#4f46e5', color: f.danger ? '#b91c1c' : f.warn ? '#92400e' : 'white' }
                : { color: '#64748b' }
              }
            >
              {f.label}
              <span
                className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{
                  background: filter === f.key ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                  color: filter === f.key ? 'inherit' : '#94a3b8',
                }}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {!displayed.length ? (
          <div className="py-12 text-center">
            <BarChart2 size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-slate-400 text-sm">
              {stockData?.length === 0 ? 'Aucun produit. Ajoutez des articles d\'abord.' : 'Aucun résultat pour cette recherche.'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map(hg => (
                <TableRow key={hg.id}>
                  {hg.headers.map(header => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getAllCells().map(cell => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Modal entrée en stock */}
      <Dialog open={!!addModal} onOpenChange={open => { if (!open) setAddModal(null); }}>
        <DialogContent className="max-w-sm">
          {addModal && <EntreeModal product={addModal} onSave={saveEntree} onClose={() => setAddModal(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EntreeModalProps {
  product: StockRow;
  onSave: (productId: number, qty: string, note: string) => void;
  onClose: () => void;
}

function EntreeModal({ product, onSave, onClose }: EntreeModalProps) {
  const [qty,  setQty]  = useState('');
  const [note, setNote] = useState('');
  const meter = isMeter(product.unit);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Entrée en stock</DialogTitle>
        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[220px]">{product.name}</p>
      </DialogHeader>

      <div className="px-6 py-5 space-y-4">
        <div>
          <Label className="block mb-1.5">Quantité reçue {product.unit ? `(${product.unit})` : ''}</Label>
          <Input
            type="number"
            min="0"
            step={meter ? '0.001' : '1'}
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder={meter ? 'Ex: 12.50' : 'Ex: 10'}
            autoFocus
          />
          {meter && <p className="text-xs mt-1.5 text-primary">Décimales autorisées (ex: 2.75)</p>}
        </div>
        <div>
          <Label className="block mb-1.5">Référence / Note</Label>
          <Input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Ex: Réception commande n°..."
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Annuler
        </Button>
        <Button
          className="flex-1"
          onClick={() => Number(qty) > 0 && product.id != null && onSave(product.id, qty, note)}
        >
          <Check size={15} /> Valider l'entrée
        </Button>
      </DialogFooter>
    </>
  );
}
