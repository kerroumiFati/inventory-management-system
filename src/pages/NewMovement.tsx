import { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProductByBarcode, getNextBonNumber, checkStockDisponible, bufferToBase64, type StockIssue } from '../db';
import { Plus, Trash2, Check, ScanLine, Paperclip, X, FileText, Image, AlertTriangle, ChevronDown } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';
import type { NavigateFn } from '../types';
import type { Product } from '../../shared/schemas';

interface MovementItem {
  productId: string;
  quantity: string | number;
  note: string;
}

interface ProductSearchProps {
  products: Product[] | undefined;
  value: string;
  onChange: (value: string) => void;
}

function ProductSearch({ products, value, onChange }: ProductSearchProps) {
  const [query, setQuery]   = useState('');
  const [open,  setOpen]    = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = products?.find(p => String(p.id) === String(value));

  // Fermer si clic extérieur
  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const filtered = (products || []).filter(p => {
    const q = query.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.reference || '').toLowerCase().includes(q) ||
      (p.category  || '').toLowerCase().includes(q)
    );
  }).slice(0, 50);

  function select(p: Product) {
    onChange(String(p.id));
    setQuery('');
    setOpen(false);
  }

  function handleFocus() {
    setQuery('');
    setOpen(true);
  }

  return (
    <div ref={ref} className="relative flex-1">
      <div
        className="flex items-center gap-1 px-2 py-2 border border-slate-200 rounded-lg bg-white cursor-text"
        style={{ minHeight: 38 }}
        onClick={() => { setOpen(true); ref.current?.querySelector('input')?.focus(); }}
      >
        {!open && selected ? (
          <span className="flex-1 text-sm text-slate-700 truncate">
            {selected.reference ? `[${selected.reference}] ` : ''}{selected.name}
          </span>
        ) : (
          <input
            autoFocus={open}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={handleFocus}
            placeholder={selected ? `${selected.name}` : '— Rechercher un produit —'}
            className="flex-1 text-sm outline-none bg-transparent min-w-0"
          />
        )}
        <ChevronDown size={13} className="text-slate-400 shrink-0" />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
             style={{ maxHeight: 260 }}>
          {/* Option vide */}
          <div
            onMouseDown={() => { onChange(''); setQuery(''); setOpen(false); }}
            className="px-3 py-2 text-sm text-slate-400 hover:bg-slate-50 cursor-pointer border-b border-slate-100"
          >
            — Aucun —
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 210 }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-400 text-center">Aucun résultat</div>
            ) : filtered.map(p => (
              <div
                key={p.id}
                onMouseDown={() => select(p)}
                className="px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 flex items-center justify-between gap-2"
                style={String(p.id) === String(value) ? { background: '#eef2ff', color: '#4f46e5' } : {}}
              >
                <span className="truncate">
                  {p.reference && <span className="text-xs font-mono text-slate-400 mr-1">[{p.reference}]</span>}
                  {p.name}
                </span>
                {p.category && <span className="text-xs text-slate-300 shrink-0">{p.category}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface NewMovementProps {
  navigate: NavigateFn;
}

interface AttachedFile {
  name: string;
  type: string;
  data: ArrayBuffer;
}

export default function NewMovement({ navigate }: NewMovementProps) {
  const products = useLiveQuery(() => db.products.toArray(), []);
  const [items, setItems] = useState<MovementItem[]>([{ productId: '', quantity: 1, note: '' }]);
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<AttachedFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanningIdx, setScanningIdx] = useState<number | null>(null);
  const [stockIssues, setStockIssues] = useState<StockIssue[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function addItem() {
    setItems(i => [...i, { productId: '', quantity: 1, note: '' }]);
  }
  function removeItem(idx: number) {
    setItems(i => i.filter((_, j) => j !== idx));
    setStockIssues([]);
  }
  function updateItem(idx: number, field: keyof MovementItem, val: string) {
    setItems(i => i.map((item, j) => j === idx ? { ...item, [field]: val } : item));
    setStockIssues([]);
  }

  async function handleScan(code: string) {
    setScanningIdx(null);
    const found = await getProductByBarcode(code);
    if (found) {
      const emptyIdx = items.findIndex(i => !i.productId);
      if (emptyIdx >= 0) updateItem(emptyIdx, 'productId', String(found.id));
      else setItems(prev => [...prev, { productId: String(found.id), quantity: 1, note: '' }]);
    } else {
      alert(`Produit introuvable pour le code : ${code}`);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const data = await f.arrayBuffer();
    setFile({ name: f.name, type: f.type, data });
    e.target.value = '';
  }

  function getStep(productId: string) {
    const p = products?.find(p => p.id === Number(productId));
    return p?.unit && ['m', 'm²', 'm³', 'mètre linéaire'].includes(p.unit) ? '0.001' : '1';
  }
  function getUnit(productId: string) {
    return products?.find(p => p.id === Number(productId))?.unit || '';
  }

  async function submit() {
    const valid = items.filter(i => i.productId && Number(i.quantity) > 0);
    if (valid.length === 0) return alert('Ajoutez au moins un produit.');

    // Vérification stock disponible
    const issues = await checkStockDisponible(valid);
    if (issues.length > 0) {
      setStockIssues(issues);
      return;
    }

    setSaving(true);
    const date = new Date().toISOString();
    const number = await getNextBonNumber();

    // Convertir le fichier en base64 pour le stockage JSON
    const fileData = file?.data ? bufferToBase64(file.data) : null;

    const bonId = await db.bons.add({
      number,
      date,
      type: 'sortie',
      destination,
      note,
      isFormal: false,
      fileName: file?.name || null,
      fileType: file?.type || null,
      fileData,
    }) as number; // l'id auto-incrémenté est toujours défini une fois l'ajout terminé

    for (const item of valid) {
      await db.bonItems.add({
        bonId,
        productId: Number(item.productId),
        quantity: Number(item.quantity),
        note: item.note || '',
      });
      await db.movements.add({
        productId: Number(item.productId),
        type: 'sortie',
        date,
        quantity: Number(item.quantity),
        bonNumber: number,
        note: item.note || '',
      });
    }

    setSaving(false);
    navigate('bon-detail', { bonId });
  }

  const fileIcon = file?.type?.startsWith('image/') ? <Image size={15} /> : <FileText size={15} />;

  return (
    <div>
      {scanningIdx !== null && (
        <BarcodeScanner onScan={handleScan} onClose={() => setScanningIdx(null)} />
      )}

      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Sortie de stock</h1>
        <p className="text-sm text-slate-500 mt-0.5">Enregistrez les produits sortis</p>
      </div>

      {/* Destination + Note */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide block mb-1">Destination / Demandeur</label>
            <input
              value={destination}
              onChange={e => setDestination(e.target.value)}
              placeholder="Ex: Chantier A, Service maintenance..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide block mb-1">Observations</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Remarques..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>
      </div>

      {/* Alerte stock insuffisant */}
      {stockIssues.length > 0 && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 bg-red-50">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-2">
            <AlertTriangle size={16} /> Stock insuffisant — sortie bloquée
          </div>
          <ul className="space-y-1">
            {stockIssues.map((issue, i) => (
              <li key={i} className="text-xs text-red-600">
                <span className="font-medium">{issue.name}</span> : demandé {issue.requested} {issue.unit}, disponible {issue.available} {issue.unit}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lignes produits */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Produits sortis</h2>
          <button
            onClick={() => setScanningIdx(-1)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
          >
            <ScanLine size={14} /> Scanner
          </button>
        </div>

        <div className="space-y-3">
          {items.map((item, idx) => {
            const unit = getUnit(item.productId);
            const step = getStep(item.productId);
            return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg" style={{ background: '#f8fafc' }}>
                <div className="col-span-12 md:col-span-5">
                  <label className="text-xs text-slate-400 block mb-1">Libellé</label>
                  <div className="flex gap-1.5">
                    <ProductSearch
                      products={products}
                      value={item.productId}
                      onChange={val => updateItem(idx, 'productId', val)}
                    />
                    <button
                      onClick={() => setScanningIdx(idx)}
                      className="px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                    >
                      <ScanLine size={15} />
                    </button>
                  </div>
                </div>

                <div className="col-span-5 md:col-span-3">
                  <label className="text-xs text-slate-400 block mb-1">Q. Sortie</label>
                  <div className="relative">
                    <input
                      type="number" min="0" step={step} value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className={`w-full px-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white ${unit ? 'pr-8' : ''}`}
                    />
                    {unit && <span className="absolute right-2 top-2 text-xs text-slate-400">{unit}</span>}
                  </div>
                </div>

                <div className="col-span-6 md:col-span-3">
                  <label className="text-xs text-slate-400 block mb-1">Observations</label>
                  <input
                    value={item.note}
                    onChange={e => updateItem(idx, 'note', e.target.value)}
                    placeholder="Remarque..."
                    className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
                  />
                </div>

                <div className="col-span-1 flex justify-end items-end pb-0.5">
                  {items.length > 1 && (
                    <button onClick={() => removeItem(idx)} className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={addItem} className="mt-3 flex items-center gap-2 text-sm font-medium" style={{ color: '#4f46e5' }}>
          <Plus size={15} /> Ajouter une ligne
        </button>
      </div>

      {/* Pièce jointe — optionnelle */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 mb-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Pièce jointe <span className="normal-case font-normal text-slate-300 ml-1">— optionnel</span>
        </h2>

        {file ? (
          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-indigo-100" style={{ background: '#eef2ff' }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <span style={{ color: '#4f46e5' }}>{fileIcon}</span>
              <span className="text-sm font-medium text-slate-700 truncate">{file.name}</span>
              <span className="text-xs text-slate-400 shrink-0">
                {(file.data.byteLength / 1024).toFixed(0)} Ko
              </span>
            </div>
            <button
              onClick={() => setFile(null)}
              className="ml-3 p-1 rounded text-slate-400 hover:text-red-500 shrink-0"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-lg text-sm text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
          >
            <Paperclip size={16} />
            Joindre un bon, PDF, photo...
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      <button
        onClick={submit}
        disabled={saving}
        className="w-full py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        style={{ background: '#4f46e5' }}
      >
        {saving ? 'Enregistrement...' : <><Check size={17} /> Valider la sortie</>}
      </button>
    </div>
  );
}
