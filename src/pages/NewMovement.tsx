import { useState, useRef, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getProductByBarcode, checkStockDisponible, createBon, bufferToBase64, type StockIssue } from '../db';
import { computeStockLevels, formatQty, quantityStep, type StockLevel } from '@/lib/stock';
import { Plus, Trash2, Check, ScanLine, Paperclip, X, FileText, Image, AlertTriangle, ChevronDown } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';
import type { NavigateFn } from '../types';
import { loadDraft, saveDraft, clearDraft, isDraftEmpty, type DraftKind, type DraftItem } from '@/lib/drafts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

type MovementItem = DraftItem;

interface ProductSearchProps {
  products: StockLevel[] | undefined;
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
      (p.barcode   || '').toLowerCase().includes(q) ||
      (p.category  || '').toLowerCase().includes(q)
    );
  }).slice(0, 50);

  function select(p: StockLevel) {
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
                <span
                  className={`text-xs shrink-0 ${p.status === 'empty' ? 'text-red-500' : p.status === 'low' ? 'text-amber-600' : 'text-slate-400'}`}
                  title="Stock disponible"
                >
                  {formatQty(p.qty, p.unit)}
                </span>
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
  kind: DraftKind;
}

const TEXTS: Record<DraftKind, {
  title: string; subtitle: string; partyLabel: string; partyPlaceholder: string; itemsTitle: string; qtyLabel: string; submit: string;
}> = {
  sortie: {
    title: 'Sortie de stock', subtitle: 'Enregistrez les produits sortis',
    partyLabel: 'Destination / Demandeur', partyPlaceholder: 'Ex: Chantier A, Service maintenance...',
    itemsTitle: 'Produits sortis', qtyLabel: 'Q. Sortie', submit: 'Valider la sortie',
  },
  entree: {
    title: 'Entrée de stock', subtitle: 'Enregistrez une réception (livraison, retour...) en une seule fois',
    partyLabel: 'Fournisseur / Provenance', partyPlaceholder: 'Ex: Fournisseur X, BL n°...',
    itemsTitle: 'Produits reçus', qtyLabel: 'Q. Reçue', submit: 'Valider la réception',
  },
  commande: {
    title: 'Bon de commande', subtitle: "Commande fournisseur — le stock ne change qu'à la réception",
    partyLabel: 'Fournisseur', partyPlaceholder: 'Ex: Fournisseur X',
    itemsTitle: 'Produits commandés', qtyLabel: 'Q. Commandée', submit: 'Enregistrer la commande',
  },
};

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const emptyItem = (): MovementItem => ({ productId: '', quantity: 1, note: '' });

interface AttachedFile {
  name: string;
  type: string;
  data: ArrayBuffer;
}

export default function NewMovement({ navigate, kind }: NewMovementProps) {
  const t = TEXTS[kind];
  const [initialDraft] = useState(() => loadDraft(kind));
  const rawProducts = useLiveQuery(() => db.products.toArray(), []);
  const movements   = useLiveQuery(() => db.movements.toArray(), []);
  const products = useMemo(
    () => rawProducts && movements ? computeStockLevels(rawProducts, movements) : undefined,
    [rawProducts, movements]
  );
  const [items, setItems] = useState<MovementItem[]>(() => initialDraft?.items ?? [emptyItem()]);
  const [destination, setDestination] = useState(initialDraft?.destination ?? '');
  const [note, setNote] = useState(initialDraft?.note ?? '');
  const [draftRestored, setDraftRestored] = useState(() => !!initialDraft && !isDraftEmpty(initialDraft) && !initialDraft.orderUid);
  const prepared = initialDraft?.preparedBy === 'reappro';
  // Réception d'une commande (préparée depuis la commande).
  const [order, setOrder] = useState(() => initialDraft?.orderUid
    ? { uid: initialDraft.orderUid, number: initialDraft.orderNumber ?? '' }
    : null);
  const [file, setFile] = useState<AttachedFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanningIdx, setScanningIdx] = useState<number | null>(null);
  const [stockIssues, setStockIssues] = useState<StockIssue[]>([]);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveDraft(kind, { items, destination, note, orderUid: order?.uid ?? null, orderNumber: order?.number });
  }, [items, destination, note, kind, order]);

  function clearForm() {
    setItems([emptyItem()]);
    setDestination('');
    setNote('');
    setFile(null);
    setStockIssues([]);
    setError('');
    setDraftRestored(false);
    setOrder(null);
  }

  function addItem() {
    setItems(i => [...i, emptyItem()]);
  }
  function removeItem(idx: number) {
    setItems(i => i.filter((_, j) => j !== idx));
    setStockIssues([]);
  }
  function updateItem(idx: number, field: keyof MovementItem, val: string) {
    setItems(i => i.map((item, j) => j === idx ? { ...item, [field]: val } : item));
    // Commande : le fournisseur habituel du premier produit choisi pré-remplit le champ.
    if (kind === 'commande' && field === 'productId' && !destination.trim()) {
      const supplier = findProduct(val)?.supplier;
      if (supplier) setDestination(supplier);
    }
    setStockIssues([]);
    setError('');
  }

  // Scan : si le produit est déjà dans la liste, on incrémente sa quantité ;
  // sinon on remplit la ligne ciblée (ou la première ligne vide, ou une nouvelle ligne).
  async function handleScan(code: string) {
    const targetIdx = scanningIdx;
    setScanningIdx(null);
    const found = await getProductByBarcode(code);
    if (!found) {
      setError(`Aucun produit avec le code-barres « ${code} ». Ajoutez-le d'abord dans Produits.`);
      return;
    }
    const pid = String(found.id);
    setError('');
    setStockIssues([]);
    setItems(prev => {
      const existing = prev.findIndex(i => i.productId === pid);
      if (existing >= 0) {
        return prev.map((item, j) => j === existing ? { ...item, quantity: (Number(item.quantity) || 0) + 1 } : item);
      }
      const idx = targetIdx != null && targetIdx >= 0 ? targetIdx : prev.findIndex(i => !i.productId);
      if (idx >= 0) return prev.map((item, j) => j === idx ? { ...item, productId: pid } : item);
      return [...prev, { ...emptyItem(), productId: pid }];
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    // La pièce jointe est stockée dans le bon et synchronisée avec lui : on évite les fichiers énormes.
    if (f.size > MAX_ATTACHMENT_BYTES) {
      setError(`Fichier trop volumineux (${(f.size / 1048576).toFixed(1)} Mo). Maximum : ${MAX_ATTACHMENT_BYTES / 1048576} Mo — réduisez la photo ou scannez en qualité moindre.`);
      return;
    }
    const data = await f.arrayBuffer();
    setFile({ name: f.name, type: f.type, data });
  }

  function findProduct(productId: string) {
    return products?.find(p => p.id === Number(productId));
  }

  async function submit() {
    const valid = items.filter(i => i.productId && Number(i.quantity) > 0);
    if (valid.length === 0) {
      setError('Ajoutez au moins un produit avec une quantité supérieure à 0.');
      return;
    }

    // Vérification stock disponible (une réception ne peut pas manquer de stock)
    if (kind === 'sortie') {
      const issues = await checkStockDisponible(valid);
      if (issues.length > 0) {
        setStockIssues(issues);
        return;
      }
    }

    setSaving(true);
    try {
      const bonId = await createBon({
        type: kind,
        destination: destination.trim(),
        note: note.trim(),
        items: valid.map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity), note: i.note.trim() })),
        // Fichier converti en base64 pour le stockage JSON
        file: file ? { name: file.name, type: file.type, data: bufferToBase64(file.data) } : null,
        orderUid: order?.uid ?? null,
      });
      clearDraft(kind);
      navigate('bon-detail', { bonId });
    } catch (err) {
      setError(`Enregistrement impossible : ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  }

  const fileIcon = file?.type?.startsWith('image/') ? <Image size={15} /> : <FileText size={15} />;

  return (
    <div>
      {scanningIdx !== null && (
        <BarcodeScanner onScan={handleScan} onClose={() => setScanningIdx(null)} />
      )}

      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">{t.title}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t.subtitle}</p>
      </div>

      {draftRestored && (
        <div className="mb-4 flex items-center justify-between gap-3 text-sm text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
          <span>{prepared ? 'Commande préparée depuis le réapprovisionnement : vérifiez les quantités puis enregistrez.' : 'Saisie en cours restaurée.'}</span>
          <span className="flex gap-3 shrink-0">
            <button onClick={() => setDraftRestored(false)} className="underline hover:text-indigo-950">Continuer</button>
            <button onClick={clearForm} className="underline hover:text-indigo-950">Tout effacer</button>
          </span>
        </div>
      )}

      {order && (
        <div className="mb-4 flex items-center justify-between gap-3 text-sm text-sky-800 bg-sky-50 border border-sky-100 rounded-xl px-4 py-3">
          <span>Réception de la commande <span className="font-semibold">{order.number}</span> — quantités restant à recevoir pré-remplies, ajustez-les si la livraison est partielle.</span>
          <button onClick={() => setOrder(null)} className="underline hover:text-sky-950 shrink-0">Détacher</button>
        </div>
      )}

      {/* Destination + Note */}
      <Card className="shadow-sm p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="block mb-1">{t.partyLabel}</Label>
            <Input
              value={destination}
              onChange={e => setDestination(e.target.value)}
              placeholder={t.partyPlaceholder}
            />
          </div>
          <div>
            <Label className="block mb-1">Observations</Label>
            <Input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Remarques..."
            />
          </div>
        </div>
      </Card>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-4 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Alerte stock insuffisant */}
      {stockIssues.length > 0 && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 bg-red-50">
          <div className="flex items-center gap-2 text-red-700 font-semibold text-sm mb-2">
            <AlertTriangle size={16} /> Stock insuffisant — sortie bloquée
          </div>
          <ul className="space-y-1">
            {stockIssues.map((issue, i) => (
              <li key={i} className="text-xs text-red-600">
                <span className="font-medium">{issue.name}</span> : demandé {formatQty(issue.requested, issue.unit)}, disponible {formatQty(issue.available, issue.unit)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lignes produits */}
      <Card className="shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t.itemsTitle}</h2>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setScanningIdx(-1)}>
            <ScanLine size={14} /> Scanner
          </Button>
        </div>

        <div className="space-y-3">
          {items.map((item, idx) => {
            const product = findProduct(item.productId);
            const unit = product?.unit || '';
            const step = quantityStep(unit);
            const delta     = (Number(item.quantity) || 0) * (kind === 'sortie' ? -1 : 1);
            const remaining = product ? product.qty + delta : null;
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
                      title="Scanner le code-barres pour cette ligne"
                      aria-label="Scanner le code-barres pour cette ligne"
                      className="px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                    >
                      <ScanLine size={15} />
                    </button>
                  </div>
                </div>

                <div className="col-span-5 md:col-span-3">
                  <label className="text-xs text-slate-400 block mb-1">{t.qtyLabel}</label>
                  <div className="relative">
                    <Input
                      type="number" min="0" step={step} value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className={`bg-white ${unit ? 'pr-8' : ''}`}
                    />
                    {unit && <span className="absolute right-2 top-2.5 text-xs text-slate-400">{unit}</span>}
                  </div>
                  {product && kind === 'sortie' && (
                    <p className={`text-[11px] mt-1 ${remaining != null && remaining < 0 ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                      Dispo : {formatQty(product.qty, unit)}
                      {remaining != null && remaining < 0 && ' — insuffisant'}
                    </p>
                  )}
                  {product && kind === 'commande' && (
                    <p className="text-[11px] mt-1 text-slate-400">
                      Stock : {formatQty(product.qty, unit)}{Number(product.minStock) > 0 && ` · min ${formatQty(Number(product.minStock), unit)}`}
                    </p>
                  )}
                  {product && kind === 'entree' && remaining != null && (
                    <p className="text-[11px] mt-1 text-slate-400">
                      Stock : {formatQty(product.qty, unit)} → <span className="font-medium text-emerald-700">{formatQty(remaining, unit)}</span>
                    </p>
                  )}
                </div>

                <div className="col-span-6 md:col-span-3">
                  <label className="text-xs text-slate-400 block mb-1">Observations</label>
                  <Input
                    value={item.note}
                    onChange={e => updateItem(idx, 'note', e.target.value)}
                    placeholder="Remarque..."
                    className="bg-white"
                  />
                </div>

                <div className="col-span-1 flex justify-end items-end pb-0.5">
                  {items.length > 1 && (
                    <button onClick={() => removeItem(idx)} title="Retirer la ligne" aria-label="Retirer la ligne" className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Button variant="link" onClick={addItem} className="mt-3 px-0 h-auto">
          <Plus size={15} /> Ajouter une ligne
        </Button>
      </Card>

      {/* Pièce jointe — optionnelle */}
      <Card className="shadow-sm p-5 mb-5">
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
      </Card>

      <Button onClick={submit} disabled={saving} className="w-full py-3 h-auto text-sm font-semibold">
        {saving ? 'Enregistrement...' : <><Check size={17} /> {t.submit}</>}
      </Button>
    </div>
  );
}
