import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Plus, Pencil, Trash2, X, Check, Package, Search, ScanLine } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';

const UNITS = ['pièce', 'kg', 'g', 'litre', 'ml', 'm', 'm²', 'm³', 'mètre linéaire', 'rouleau', 'boîte', 'sachet', 'tonne'];
const isMeter = u => ['m', 'm²', 'm³', 'mètre linéaire'].includes(u);
const empty = { name: '', reference: '', barcode: '', category: '', unit: 'pièce', minStock: 0, stockInitial: 0, description: '' };

export default function Products() {
  const products  = useLiveQuery(() => db.products.toArray(), []);
  const movements = useLiveQuery(() => db.movements.toArray(), []);
  const [form,    setForm]    = useState(null);
  const [search,  setSearch]  = useState('');
  const [scanner, setScanner] = useState(null);

  const qtyMap = {};
  movements?.forEach(m => {
    if (!qtyMap[m.productId]) qtyMap[m.productId] = 0;
    if (m.type === 'entree') qtyMap[m.productId] += m.quantity;
    else                     qtyMap[m.productId] -= m.quantity;
  });

  const filtered = products?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.reference || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.barcode   || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.category  || '').toLowerCase().includes(search.toLowerCase())
  );

  async function save() {
    if (!form.name.trim()) return;
    const data = {
      name:         form.name,
      reference:    form.reference    || '',
      barcode:      form.barcode      || '',
      category:     form.category     || '',
      unit:         form.unit         || 'pièce',
      minStock:     Number(form.minStock)     || 0,
      stockInitial: Number(form.stockInitial) || 0,
      description:  form.description  || '',
    };
    if (form.id) await db.products.update(form.id, data);
    else         await db.products.add(data);
    setForm(null);
  }

  async function del(id) {
    if (!confirm('Supprimer ce produit ?')) return;
    await db.products.delete(id);
  }

  return (
    <div>
      {scanner === 'search' && <BarcodeScanner onScan={c => { setScanner(null); setSearch(c); }}       onClose={() => setScanner(null)} />}
      {scanner === 'form'   && <BarcodeScanner onScan={c => { setScanner(null); setForm(f => ({ ...f, barcode: c })); }} onClose={() => setScanner(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Produits</h1>
          <p className="text-sm text-slate-500 mt-0.5">{products?.length ?? 0} article(s) catalogué(s)</p>
        </div>
        <button
          onClick={() => setForm({ ...empty })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: '#4f46e5' }}
        >
          <Plus size={16} /> Ajouter
        </button>
      </div>

      {/* Recherche */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            placeholder="Rechercher libellé, référence, famille, code-barres..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <button
          onClick={() => setScanner('search')}
          className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
          title="Scanner un code-barres"
        >
          <ScanLine size={17} />
        </button>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {/* En-tête */}
        <div
          className="grid px-5 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider"
          style={{
            gridTemplateColumns: '80px 1fr 120px 110px 70px 80px',
            background: '#f8fafc',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <div>Réf</div>
          <div>Libellé</div>
          <div>Famille</div>
          <div className="text-center">Q. Actuel</div>
          <div className="text-center">Min</div>
          <div></div>
        </div>

        {filtered?.length === 0 && (
          <div className="py-16 text-center">
            <Package size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-slate-400 text-sm">
              {products?.length === 0 ? 'Aucun produit. Cliquez sur « Ajouter ».' : 'Aucun résultat pour cette recherche.'}
            </p>
          </div>
        )}

        {filtered?.map((p, i) => {
          const qActuel = Number(p.stockInitial || 0) + (qtyMap[p.id] || 0);
          const isLow   = p.minStock > 0 && qActuel <= p.minStock;
          const isEmpty = qActuel <= 0;
          return (
            <div
              key={p.id}
              className="grid items-center px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors"
              style={{ gridTemplateColumns: '80px 1fr 120px 110px 70px 80px' }}
            >
              {/* Réf */}
              <div>
                <div className="text-xs font-mono font-semibold text-slate-500">{p.reference || '—'}</div>
                {p.barcode && (
                  <div className="text-[10px] font-mono mt-0.5 truncate" style={{ color: '#4f46e5' }}>{p.barcode}</div>
                )}
              </div>

              {/* Libellé */}
              <div className="min-w-0 pr-3">
                <div className="text-sm font-semibold text-slate-800 truncate">{p.name}</div>
                {p.description && <div className="text-xs text-slate-400 truncate">{p.description}</div>}
              </div>

              {/* Famille */}
              <div>
                {p.category
                  ? <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: '#eef2ff', color: '#4f46e5' }}>{p.category}</span>
                  : <span className="text-xs text-slate-300">—</span>
                }
              </div>

              {/* Q. Actuel */}
              <div className="text-center">
                <span
                  className="text-base font-bold"
                  style={{ color: isEmpty ? '#dc2626' : isLow ? '#d97706' : '#059669' }}
                >
                  {qActuel}
                </span>
                <span className="text-xs text-slate-400 ml-1">{p.unit}</span>
              </div>

              {/* Min */}
              <div className="text-center">
                <span className="text-sm text-slate-400">{p.minStock || '—'}</span>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-1">
                <button
                  onClick={() => setForm({ ...p })}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  title="Modifier"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => del(p.id)}
                  className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Supprimer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal formulaire */}
      {form && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
              <h2 className="font-bold text-slate-800">{form.id ? 'Modifier le produit' : 'Nouveau produit'}</h2>
              <button onClick={() => setForm(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              <Field label="Libellé *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Référence" value={form.reference} onChange={v => setForm(f => ({ ...f, reference: v }))} />
                <Field label="Famille"   value={form.category}  onChange={v => setForm(f => ({ ...f, category: v }))} />
              </div>

              {/* Code-barres */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Code-barres</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.barcode}
                    onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                    placeholder="EAN, QR, Code128..."
                    className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                  <button
                    type="button"
                    onClick={() => setScanner('form')}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                  >
                    <ScanLine size={17} />
                  </button>
                </div>
              </div>

              {/* Unité */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Unité</label>
                <select
                  value={form.unit}
                  onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                {isMeter(form.unit) && (
                  <p className="text-xs mt-1.5 font-medium" style={{ color: '#4f46e5' }}>✓ Unité métrique — décimales autorisées</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Q. Initiale"
                  type="number"
                  step={isMeter(form.unit) ? '0.001' : '1'}
                  value={form.stockInitial}
                  onChange={v => setForm(f => ({ ...f, stockInitial: v }))}
                  suffix={form.unit}
                />
                <Field
                  label="Stock minimum"
                  type="number"
                  step={isMeter(form.unit) ? '0.001' : '1'}
                  value={form.minStock}
                  onChange={v => setForm(f => ({ ...f, minStock: v }))}
                  suffix={form.unit}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Observations</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-none"
                  rows={3}
                  placeholder="Emplacement, fournisseur, remarque..."
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 px-6 py-4" style={{ borderTop: '1px solid #f1f5f9' }}>
              <button
                onClick={() => setForm(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={save}
                className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                style={{ background: '#4f46e5' }}
              >
                <Check size={15} /> Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', step, suffix }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={type} step={step} min={type === 'number' ? '0' : undefined}
          value={value} onChange={e => onChange(e.target.value)}
          className={`w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 ${suffix ? 'pr-12' : ''}`}
        />
        {suffix && <span className="absolute right-3 top-2.5 text-xs text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}
