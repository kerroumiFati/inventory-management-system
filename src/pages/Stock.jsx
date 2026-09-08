import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProductByBarcode } from '../db';
import { ArrowUpCircle, Check, X, BarChart2, ScanLine, Search, AlertTriangle } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';

const isMeter = u => ['m', 'm²', 'm³', 'mètre linéaire'].includes(u);

function fmt(val, unit) {
  if (isMeter(unit)) return `${parseFloat(val.toFixed(3))} ${unit}`;
  return `${val} ${unit || ''}`.trim();
}

export default function Stock({ navigate }) {
  const [addModal, setAddModal] = useState(null);
  const [scanner,  setScanner]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all'); // all | low | empty

  const stockData = useLiveQuery(async () => {
    const prods = await db.products.toArray();
    const mvts  = await db.movements.toArray();
    const map   = {};
    prods.forEach(p => { map[p.id] = { ...p, qty: Number(p.stockInitial) || 0, qteUtilisee: 0 }; });
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

  async function saveEntree(productId, qty, note) {
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

  async function handleScan(code) {
    setScanner(false);
    const found = await getProductByBarcode(code);
    if (found) {
      const p = stockData?.find(s => s.id === found.id);
      if (p) setAddModal(p);
    } else {
      alert(`Produit introuvable pour le code : ${code}`);
    }
  }

  const FILTERS = [
    { key: 'all',   label: 'Tous',         count: stockData?.length ?? 0 },
    { key: 'low',   label: 'Stock faible', count: lowCount,   warn: true },
    { key: 'empty', label: 'Épuisé',       count: emptyCount, danger: true },
  ];

  return (
    <div>
      {scanner  && <BarcodeScanner onScan={handleScan} onClose={() => setScanner(false)} />}
      {addModal && <EntreeModal product={addModal} onSave={saveEntree} onClose={() => setAddModal(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Niveaux de stock</h1>
          <p className="text-sm text-slate-500 mt-0.5">{stockData?.length ?? 0} produit(s)</p>
        </div>
        <button
          onClick={() => setScanner(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
        >
          <ScanLine size={16} /> Scanner
        </button>
      </div>

      {/* Barre de recherche + filtres */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            placeholder="Rechercher libellé, référence, famille..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
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
      {!displayed.length ? (
        <div className="bg-white rounded-xl p-12 text-center border border-slate-100">
          <BarChart2 size={36} className="mx-auto mb-3 text-slate-200" />
          <p className="text-slate-400 text-sm">
            {stockData?.length === 0 ? 'Aucun produit. Ajoutez des articles d\'abord.' : 'Aucun résultat pour cette recherche.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          {/* Table header */}
          <div
            className="grid px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
            style={{ gridTemplateColumns: '1fr 120px 120px 100px 120px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}
          >
            <span>Produit</span>
            <span className="text-center">Famille</span>
            <span className="text-center">Stock actuel</span>
            <span className="text-center">Minimum</span>
            <span className="text-right">Action</span>
          </div>

          <div className="divide-y divide-slate-50">
            {displayed.map(p => {
              const min   = Number(p.minStock) || 0;
              const qty   = p.qty;
              const isNeg = qty < 0;
              const isLow = min > 0 && qty > 0 && qty <= min;
              const isEmpty = qty <= 0;
              const max   = Math.max(qty, min * 2, 1);
              const pct   = Math.min(100, Math.max(0, (qty / max) * 100));
              let statusColor  = '#10b981';
              let statusBg     = '#d1fae5';
              let statusLabel  = 'OK';
              if (isEmpty)     { statusColor = '#dc2626'; statusBg = '#fee2e2'; statusLabel = 'Épuisé'; }
              else if (isLow)  { statusColor = '#d97706'; statusBg = '#fef3c7'; statusLabel = 'Faible'; }

              return (
                <div key={p.id} className="grid items-center px-5 py-3.5 hover:bg-slate-50/50 transition-colors"
                  style={{ gridTemplateColumns: '1fr 120px 120px 100px 120px' }}>

                  {/* Produit */}
                  <div className="min-w-0 pr-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                      {p.reference && (
                        <span className="text-xs font-mono text-slate-400">{p.reference}</span>
                      )}
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${isEmpty ? 0 : pct}%`, background: statusColor }}
                        />
                      </div>
                      {p.qteUtilisee > 0 && (
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {fmt(p.qteUtilisee, p.unit)} utilisé
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Famille */}
                  <div className="text-center">
                    {p.category ? (
                      <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: '#eef2ff', color: '#4f46e5' }}>
                        {p.category}
                      </span>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </div>

                  {/* Stock actuel */}
                  <div className="text-center">
                    <div className="text-base font-bold" style={{ color: statusColor }}>{fmt(qty, p.unit)}</div>
                  </div>

                  {/* Min */}
                  <div className="text-center">
                    <span className="text-sm text-slate-400">{min > 0 ? fmt(min, p.unit) : '—'}</span>
                  </div>

                  {/* Action */}
                  <div className="flex items-center justify-end gap-2">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
                      style={{ background: statusBg, color: statusColor }}
                    >
                      {statusLabel}
                    </span>
                    <button
                      onClick={() => setAddModal(p)}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-colors hover:opacity-90"
                      style={{ background: '#d1fae5', color: '#065f46' }}
                    >
                      <ArrowUpCircle size={12} /> Entrée
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EntreeModal({ product, onSave, onClose }) {
  const [qty,  setQty]  = useState('');
  const [note, setNote] = useState('');
  const meter = isMeter(product.unit);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
          <div>
            <h2 className="font-bold text-slate-800">Entrée en stock</h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[220px]">{product.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
              Quantité reçue {product.unit ? `(${product.unit})` : ''}
            </label>
            <input
              type="number"
              min="0"
              step={meter ? '0.001' : '1'}
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder={meter ? 'Ex: 12.50' : 'Ex: 10'}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              autoFocus
            />
            {meter && <p className="text-xs mt-1.5" style={{ color: '#4f46e5' }}>Décimales autorisées (ex: 2.75)</p>}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
              Référence / Note
            </label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Ex: Réception commande n°..."
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={() => Number(qty) > 0 && onSave(product.id, qty, note)}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            style={{ background: '#059669' }}
          >
            <Check size={15} /> Valider l'entrée
          </button>
        </div>
      </div>
    </div>
  );
}
