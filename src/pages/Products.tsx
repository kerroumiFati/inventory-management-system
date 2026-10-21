import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createColumnHelper,
  flexRender,
  useTable,
} from '@tanstack/react-table';
import { sortableTableFeatures } from '@/lib/table';
import { db, countProductUsage, deleteProduct } from '../db';
import ProductHistoryDialog from '../components/ProductHistoryDialog';
import type { NavigateFn } from '../types';
import { computeStockLevels, formatMoney, formatQty, isMeterUnit as isMeter, quantityStep, type StockStatus } from '@/lib/stock';
import { Plus, Pencil, Trash2, Package, Search, ScanLine, ArrowUpDown, History } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';
import { ProductSchema } from '../../shared/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const UNITS = ['pièce', 'kg', 'g', 'litre', 'ml', 'm', 'm²', 'm³', 'mètre', 'mètre linéaire', 'rouleau', 'boîte', 'sachet', 'tonne'];

const STATUS_COLOR: Record<StockStatus, string> = { empty: '#dc2626', low: '#d97706', ok: '#059669' };

// Formulaire : tous les champs en chaînes (contrôlés depuis des <input>), convertis à l'enregistrement.
type ProductForm = {
  id?: number;
  name: string;
  reference: string;
  barcode: string;
  category: string;
  unit: string;
  minStock: string | number;
  stockInitial: string | number;
  description: string;
  unitPrice: string | number;
  supplier: string;
  maxStock: string | number;
};

const empty: ProductForm = {
  name: '', reference: '', barcode: '', category: '', unit: 'pièce', minStock: 0, stockInitial: 0, description: '',
  unitPrice: '', supplier: '', maxStock: '',
};

type ScannerTarget = 'search' | 'form' | null;

interface ProductRow {
  id?: number;
  name: string;
  reference: string;
  barcode: string;
  category: string;
  unit: string;
  minStock: number;
  stockInitial: number;
  description: string;
  unitPrice?: number;
  supplier?: string;
  maxStock?: number;
  qActuel: number;
  status: StockStatus;
}

const columnHelper = createColumnHelper<typeof sortableTableFeatures, ProductRow>();

export default function Products({ navigate }: { navigate: NavigateFn }) {
  const products  = useLiveQuery(() => db.products.toArray(), []);
  const movements = useLiveQuery(() => db.movements.toArray(), []);
  const [form,    setForm]    = useState<ProductForm | null>(null);
  const [formError, setFormError] = useState('');
  const [search,  setSearch]  = useState('');
  const [scanner, setScanner] = useState<ScannerTarget>(null);

  const [notice, setNotice] = useState('');
  const [historyId, setHistoryId] = useState<number | null>(null);

  const rows: ProductRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return computeStockLevels(products ?? [], movements ?? [])
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.reference || '').toLowerCase().includes(q) ||
        (p.barcode   || '').toLowerCase().includes(q) ||
        (p.category  || '').toLowerCase().includes(q)
      )
      .map(p => ({ ...p, qActuel: p.qty }));
  }, [products, movements, search]);

  // Familles déjà utilisées, proposées en autocomplétion pour éviter les variantes (« Tube », « TUBE », « tubes »…).
  const categories = useMemo(
    () => [...new Set((products ?? []).map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [products]
  );
  const suppliers = useMemo(
    () => [...new Set((products ?? []).map(p => p.supplier?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'fr')),
    [products]
  );

  async function save() {
    if (!form) return;
    // Un code-barres ou une référence en double rendrait le scan / l'import ambigus.
    const barcode   = form.barcode.trim();
    const reference = form.reference.trim();
    const clash = (products ?? []).find(p => p.id !== form.id && (
      (barcode && p.barcode === barcode) ||
      (reference && (p.reference || '').toLowerCase() === reference.toLowerCase())
    ));
    if (clash) {
      setFormError(clash.barcode === barcode && barcode
        ? `Ce code-barres est déjà utilisé par « ${clash.name} ».`
        : `Cette référence est déjà utilisée par « ${clash.name} ».`);
      return;
    }
    const parsed = ProductSchema.safeParse({
      ...form,
      name: form.name.trim(),
      reference,
      barcode,
      category: form.category.trim(),
      minStock: Number(form.minStock) || 0,
      stockInitial: Number(form.stockInitial) || 0,
      unitPrice: Number(form.unitPrice) || 0,
      supplier: form.supplier.trim(),
      maxStock: Number(form.maxStock) || 0,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || 'Formulaire invalide');
      return;
    }
    const data = parsed.data;
    if (form.id) await db.products.update(form.id, data);
    else         await db.products.add(data);
    setForm(null);
    setFormError('');
  }

  async function del(row: ProductRow) {
    if (row.id == null) return;
    // Supprimer un produit déjà utilisé fausserait les bons et l'historique.
    const usage = await countProductUsage(row.id);
    if (usage > 0) {
      setNotice(`« ${row.name} » ne peut pas être supprimé : il apparaît dans ${usage} mouvement(s) ou bon(s). Supprimez d'abord les bons concernés.`);
      return;
    }
    if (!confirm(`Supprimer le produit « ${row.name} » ?`)) return;
    await deleteProduct(row.id);
    setNotice('');
  }

  function editRow(row: ProductRow) {
    setForm({
      id: row.id, name: row.name, reference: row.reference, barcode: row.barcode,
      category: row.category, unit: row.unit, minStock: row.minStock,
      stockInitial: row.stockInitial,
      description: row.description,
      unitPrice: row.unitPrice || '',
      supplier: row.supplier || '',
      maxStock: row.maxStock || '',
    });
  }

  const columns = useMemo(() => columnHelper.columns([
    columnHelper.accessor('reference', {
      header: 'Réf',
      cell: ctx => (
        <div>
          <div className="text-xs font-mono font-semibold text-slate-500">{ctx.getValue() || '—'}</div>
          {ctx.row.original.barcode && (
            <div className="text-[10px] font-mono mt-0.5 truncate text-primary">{ctx.row.original.barcode}</div>
          )}
        </div>
      ),
    }),
    columnHelper.accessor('name', {
      header: ({ column }) => (
        <button className="flex items-center gap-1 hover:text-slate-600" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Libellé <ArrowUpDown size={11} />
        </button>
      ),
      cell: ctx => (
        <div className="min-w-0 pr-3">
          <div className="text-sm font-semibold text-slate-800 truncate">{ctx.getValue()}</div>
          {ctx.row.original.description && <div className="text-xs text-slate-400 truncate">{ctx.row.original.description}</div>}
        </div>
      ),
    }),
    columnHelper.accessor('category', {
      header: 'Famille',
      cell: ctx => ctx.getValue()
        ? <Badge>{ctx.getValue()}</Badge>
        : <span className="text-xs text-slate-300">—</span>,
    }),
    columnHelper.accessor('qActuel', {
      header: ({ column }) => (
        <button className="flex items-center gap-1 mx-auto hover:text-slate-600" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Q. Actuel <ArrowUpDown size={11} />
        </button>
      ),
      cell: ctx => (
        <div className="text-center">
          <span
            className="text-base font-bold"
            style={{ color: STATUS_COLOR[ctx.row.original.status] }}
          >
            {formatQty(ctx.getValue())}
          </span>
          <span className="text-xs text-slate-400 ml-1">{ctx.row.original.unit}</span>
        </div>
      ),
    }),
    columnHelper.accessor('minStock', {
      header: 'Min',
      cell: ctx => <div className="text-center text-sm text-slate-400">{ctx.getValue() || '—'}</div>,
    }),
    columnHelper.accessor(row => row.unitPrice ?? 0, {
      id: 'unitPrice',
      header: () => <div className="text-right">P.U.</div>,
      cell: ctx => (
        <div className="text-right text-sm text-slate-500 whitespace-nowrap">
          {ctx.getValue() ? formatMoney(ctx.getValue()) : '—'}
          {ctx.row.original.supplier && <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{ctx.row.original.supplier}</div>}
        </div>
      ),
    }),
    columnHelper.display({
      id: 'actions',
      cell: ctx => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => setHistoryId(ctx.row.original.id ?? null)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            title="Historique des mouvements"
            aria-label={`Historique de ${ctx.row.original.name}`}
          >
            <History size={14} />
          </button>
          <button
            onClick={() => editRow(ctx.row.original)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            title="Modifier"
            aria-label={`Modifier ${ctx.row.original.name}`}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => del(ctx.row.original)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Supprimer"
            aria-label={`Supprimer ${ctx.row.original.name}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    }),
  ]), []);

  const table = useTable({
    features: sortableTableFeatures,
    data: rows,
    columns,
  });

  return (
    <div>
      <ProductHistoryDialog productId={historyId} onClose={() => setHistoryId(null)} navigate={navigate} />
      {scanner === 'search' && <BarcodeScanner onScan={c => { setScanner(null); setSearch(c); }}       onClose={() => setScanner(null)} />}
      {scanner === 'form'   && <BarcodeScanner onScan={c => { setScanner(null); setForm(f => f ? ({ ...f, barcode: c }) : f); }} onClose={() => setScanner(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Produits</h1>
          <p className="text-sm text-slate-500 mt-0.5">{products?.length ?? 0} article(s) catalogué(s)</p>
        </div>
        <Button onClick={() => setForm({ ...empty })}>
          <Plus size={16} /> Ajouter
        </Button>
      </div>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-amber-600 hover:text-amber-800 shrink-0" aria-label="Fermer">✕</button>
        </div>
      )}

      {/* Recherche */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <Input
            placeholder="Rechercher libellé, référence, famille, code-barres..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={() => setScanner('search')} title="Scanner un code-barres">
          <ScanLine size={17} />
        </Button>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {rows.length === 0 ? (
          <div className="py-16 text-center">
            <Package size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-slate-400 text-sm">
              {products?.length === 0 ? 'Aucun produit. Cliquez sur « Ajouter ».' : 'Aucun résultat pour cette recherche.'}
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

      {/* Modal formulaire */}
      <Dialog open={!!form} onOpenChange={open => { if (!open) { setForm(null); setFormError(''); } }}>
        <DialogContent>
          {form && (
            <>
              <DialogHeader>
                <DialogTitle>{form.id ? 'Modifier le produit' : 'Nouveau produit'}</DialogTitle>
              </DialogHeader>

              <form
                id="product-form"
                onSubmit={e => { e.preventDefault(); save(); }}
                className="overflow-y-auto flex-1 px-6 py-5 space-y-4"
              >
                <Field label="Libellé *" value={form.name} autoFocus onChange={v => setForm(f => f && ({ ...f, name: v }))} />

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Référence" value={form.reference} onChange={v => setForm(f => f && ({ ...f, reference: v }))} />
                  <Field label="Famille"   value={form.category}  list="product-categories" onChange={v => setForm(f => f && ({ ...f, category: v }))} />
                  <datalist id="product-categories">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>

                {/* Code-barres */}
                <div>
                  <Label className="block mb-1.5">Code-barres</Label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={form.barcode}
                      onChange={e => setForm(f => f && ({ ...f, barcode: e.target.value }))}
                      placeholder="EAN, QR, Code128..."
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => setScanner('form')} className="shrink-0" title="Scanner le code-barres" aria-label="Scanner le code-barres">
                      <ScanLine size={17} />
                    </Button>
                  </div>
                </div>

                {/* Unité */}
                <div>
                  <Label className="block mb-1.5">Unité</Label>
                  <Select value={form.unit} onValueChange={v => setForm(f => f && ({ ...f, unit: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {isMeter(form.unit) && (
                    <p className="text-xs mt-1.5 font-medium text-primary">✓ Unité métrique — décimales autorisées</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Q. Initiale"
                    type="number"
                    step={quantityStep(form.unit)}
                    value={form.stockInitial}
                    onChange={v => setForm(f => f && ({ ...f, stockInitial: v }))}
                    suffix={form.unit}
                  />
                  <Field
                    label="Stock minimum"
                    type="number"
                    step={quantityStep(form.unit)}
                    value={form.minStock}
                    onChange={v => setForm(f => f && ({ ...f, minStock: v }))}
                    suffix={form.unit}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Prix unitaire"
                    type="number"
                    step="0.01"
                    value={form.unitPrice}
                    onChange={v => setForm(f => f && ({ ...f, unitPrice: v }))}
                  />
                  <Field
                    label="Stock cible"
                    type="number"
                    step={quantityStep(form.unit)}
                    value={form.maxStock}
                    onChange={v => setForm(f => f && ({ ...f, maxStock: v }))}
                    suffix={form.unit}
                    hint="Quantité visée au réapprovisionnement (vide : 2 × minimum)"
                  />
                </div>

                <Field
                  label="Fournisseur habituel"
                  value={form.supplier}
                  list="product-suppliers"
                  onChange={v => setForm(f => f && ({ ...f, supplier: v }))}
                />
                <datalist id="product-suppliers">
                  {suppliers.map(sup => <option key={sup} value={sup} />)}
                </datalist>

                <div>
                  <Label className="block mb-1.5">Observations</Label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => f && ({ ...f, description: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    rows={3}
                    placeholder="Emplacement, remarque..."
                  />
                </div>

                {formError && (
                  <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <span className="font-semibold shrink-0">!</span>
                    <span>{formError}</span>
                  </div>
                )}
              </form>

              <DialogFooter>
                <Button variant="outline" className="flex-1" onClick={() => { setForm(null); setFormError(''); }}>
                  Annuler
                </Button>
                <Button className="flex-1" type="submit" form="product-form">
                  Enregistrer
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  suffix?: string;
  list?: string;
  autoFocus?: boolean;
  hint?: string;
}

function Field({ label, value, onChange, type = 'text', step, suffix, list, autoFocus, hint }: FieldProps) {
  return (
    <div>
      <Label className="block mb-1.5">{label}</Label>
      <div className="relative">
        <Input
          type={type} step={step} min={type === 'number' ? '0' : undefined} list={list} autoFocus={autoFocus}
          value={value} onChange={e => onChange(e.target.value)}
          className={suffix ? 'pr-12' : ''}
        />
        {suffix && <span className="absolute right-3 top-2.5 text-xs text-slate-400">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
