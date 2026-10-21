import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, createInventory, getProductByBarcode } from '../db';
import { computeStockLevels, formatMoney, formatQty, inventoryLines, quantityStep } from '@/lib/stock';
import { ClipboardCheck, ScanLine, Search, Check, AlertTriangle, Equal, Eraser } from 'lucide-react';
import BarcodeScanner from '../components/BarcodeScanner';
import type { NavigateFn } from '../types';
import { CURRENCY } from '../config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const DRAFT_KEY = 'stock_draft_inventaire';
const ALL = '__all__';

// Comptage en cours, conservé si l'on change de page (un inventaire peut durer longtemps).
interface InventoryDraft {
  category: string;
  counts: Record<string, string>;
  note: string;
}

function loadDraft(): InventoryDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) as InventoryDraft : null;
  } catch { return null; }
}

export default function Inventory({ navigate }: { navigate: NavigateFn }) {
  const [initial] = useState(loadDraft);
  const [category, setCategory] = useState(initial?.category ?? ALL);
  const [counts, setCounts] = useState<Record<string, string>>(initial?.counts ?? {});
  const [note, setNote] = useState(initial?.note ?? '');
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const levels = useLiveQuery(async () => {
    const [prods, mvts] = await Promise.all([db.products.toArray(), db.movements.toArray()]);
    return computeStockLevels(prods, mvts)
      .sort((a, b) => (a.category || '').localeCompare(b.category || '', 'fr') || a.name.localeCompare(b.name, 'fr'));
  }, []);

  useEffect(() => {
    try {
      if (!Object.keys(counts).length && !note.trim()) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ category, counts, note }));
    } catch {
      // Stockage indisponible : le comptage n'est simplement pas conservé.
    }
  }, [category, counts, note]);

  const categories = useMemo(
    () => [...new Set((levels ?? []).map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [levels]
  );
  const inScope = useMemo(
    () => (levels ?? []).filter(p => category === ALL || p.category === category),
    [levels, category]
  );
  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return inScope;
    return inScope.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.reference || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
  }, [inScope, search]);

  const lines = useMemo(() => inventoryLines(inScope, counts), [inScope, counts]);
  const byProduct = useMemo(() => new Map(lines.map(l => [l.productId, l])), [lines]);
  const gaps = lines.filter(l => l.diff !== 0);
  const surplus = gaps.reduce((s, l) => s + Math.max(0, l.diffValue), 0);
  const missing = gaps.reduce((s, l) => s + Math.min(0, l.diffValue), 0);
  const hasPrices = inScope.some(p => Number(p.unitPrice) > 0);

  function setCount(productId: number, value: string) {
    setCounts(c => {
      const next = { ...c };
      if (value === '') delete next[productId];
      else next[productId] = value;
      return next;
    });
  }

  function changeCategory(value: string) {
    // Les comptages hors du nouveau périmètre seraient ignorés : on prévient plutôt que de les perdre en silence.
    const outside = Object.keys(counts).filter(id => {
      const p = levels?.find(l => String(l.id) === id);
      return p && value !== ALL && p.category !== value;
    });
    if (outside.length && !confirm(`${outside.length} produit(s) déjà compté(s) sont hors de ce périmètre et ne seront pas pris en compte. Continuer ?`)) return;
    setCategory(value);
  }

  function fillUncounted() {
    setCounts(c => {
      const next = { ...c };
      for (const p of inScope) if (p.id != null && next[p.id] === undefined) next[p.id] = String(parseFloat(p.qty.toFixed(3)));
      return next;
    });
  }

  function reset() {
    if (Object.keys(counts).length && !confirm('Effacer tous les comptages saisis ?')) return;
    setCounts({});
    setNote('');
    setMessage(null);
  }

  // Scan : chaque passage d'un article ajoute 1 à sa quantité comptée.
  async function handleScan(code: string) {
    setScanning(false);
    const found = await getProductByBarcode(code);
    const p = found && inScope.find(l => l.id === found.id);
    if (!p || p.id == null) {
      setMessage({ text: found ? `« ${found.name} » ne fait pas partie de ce périmètre.` : `Aucun produit avec le code-barres « ${code} ».`, error: true });
      return;
    }
    const next = (Number(counts[p.id]) || 0) + 1;
    setCount(p.id, String(next));
    setLastScanned(p.id);
    setSearch('');
    setMessage({ text: `${p.name} : ${formatQty(next, p.unit)} compté(s).` });
    setTimeout(() => document.getElementById(`inv-row-${p.id}`)?.scrollIntoView({ block: 'center' }), 50);
  }

  async function validate() {
    if (!lines.length) {
      setMessage({ text: 'Saisissez au moins une quantité comptée.', error: true });
      return;
    }
    const uncounted = inScope.length - lines.length;
    const text = [
      `Valider l'inventaire ?`,
      `${lines.length} produit(s) compté(s), ${gaps.length} écart(s).`,
      'Le stock de chaque produit compté sera ajusté à la quantité comptée.',
      uncounted > 0 ? `${uncounted} produit(s) non compté(s) ne seront pas modifiés.` : '',
    ].filter(Boolean).join('\n');
    if (!confirm(text)) return;
    setSaving(true);
    try {
      const bonId = await createInventory({
        scope: category === ALL ? 'Tout le stock' : `Famille : ${category}`,
        note: note.trim(),
        lines,
      });
      localStorage.removeItem(DRAFT_KEY);
      navigate('bon-detail', { bonId });
    } catch (err) {
      setMessage({ text: `Enregistrement impossible : ${err instanceof Error ? err.message : String(err)}`, error: true });
      setSaving(false);
    }
  }

  return (
    <div>
      {scanning && <BarcodeScanner onScan={handleScan} onClose={() => setScanning(false)} />}

      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Inventaire</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Comptez le stock réel : à la validation, le stock des produits comptés est ajusté et un bon INV est créé.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={!Object.keys(counts).length && !note}>
            <Eraser size={15} /> Recommencer
          </Button>
          <Button variant="outline" onClick={() => setScanning(true)}>
            <ScanLine size={15} /> Scanner
          </Button>
        </div>
      </div>

      {/* Périmètre + note */}
      <Card className="shadow-sm p-5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="block mb-1">Périmètre</Label>
            <Select value={category} onValueChange={changeCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tout le stock</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>Famille : {c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1">Observations</Label>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: inventaire annuel, magasin principal..." />
          </div>
        </div>
      </Card>

      {/* Avancement */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Comptés" value={`${lines.length} / ${inScope.length}`} />
        <Stat label="Écarts" value={String(gaps.length)} tone={gaps.length ? 'warn' : undefined} />
        {hasPrices && <Stat label="Surplus (valeur)" value={`+${formatMoney(surplus, CURRENCY)}`} tone="ok" />}
        {hasPrices && <Stat label="Manquants (valeur)" value={formatMoney(missing, CURRENCY)} tone={missing < 0 ? 'bad' : undefined} />}
      </div>

      {message && (
        <div className={`mb-4 flex items-start gap-2 text-sm rounded-xl px-4 py-3 border ${message.error ? 'text-red-700 bg-red-50 border-red-200' : 'text-indigo-800 bg-indigo-50 border-indigo-100'}`}>
          {message.error && <AlertTriangle size={16} className="shrink-0 mt-0.5" />}
          <span className="flex-1">{message.text}</span>
          <button onClick={() => setMessage(null)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Fermer">✕</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <Input placeholder="Rechercher libellé, référence, code-barres..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="outline" onClick={fillUncounted} disabled={lines.length === inScope.length} title="Reporte le stock théorique sur chaque produit non compté">
          <Equal size={15} /> Non comptés = conformes
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto mb-5">
        {!displayed.length ? (
          <div className="py-12 text-center">
            <ClipboardCheck size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-slate-400 text-sm">{levels?.length === 0 ? 'Aucun produit à compter.' : 'Aucun produit pour cette recherche.'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="text-left font-semibold px-4 py-2.5">Produit</th>
                <th className="text-right font-semibold px-2 py-2.5">Théorique</th>
                <th className="text-left font-semibold px-2 py-2.5 w-40">Compté</th>
                <th className="text-right font-semibold px-4 py-2.5">Écart</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(p => {
                const line = p.id != null ? byProduct.get(p.id) : undefined;
                const diff = line?.diff ?? 0;
                return (
                  <tr
                    key={p.id}
                    id={`inv-row-${p.id}`}
                    className="border-b border-slate-50"
                    style={lastScanned === p.id ? { background: '#eef2ff' } : line ? { background: '#f8fafc' } : undefined}
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-800">{p.name}</div>
                      <div className="text-xs text-slate-400">
                        {[p.reference, p.category].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-500 whitespace-nowrap">{formatQty(p.qty, p.unit)}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number" min="0" step={quantityStep(p.unit)}
                          value={p.id != null ? counts[p.id] ?? '' : ''}
                          onChange={e => p.id != null && setCount(p.id, e.target.value)}
                          placeholder="—"
                          className="h-8 w-24 bg-white"
                          aria-label={`Quantité comptée pour ${p.name}`}
                        />
                        <button
                          onClick={() => p.id != null && setCount(p.id, String(parseFloat(p.qty.toFixed(3))))}
                          className="p-1.5 rounded text-slate-300 hover:text-indigo-600 hover:bg-indigo-50"
                          title="Conforme : reporter le stock théorique"
                          aria-label={`${p.name} conforme`}
                        >
                          <Equal size={13} />
                        </button>
                      </div>
                    </td>
                    <td className={`px-4 py-2 text-right font-semibold whitespace-nowrap ${!line ? 'text-slate-300' : diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {!line ? '—' : diff === 0 ? 'OK' : `${diff > 0 ? '+' : '−'}${formatQty(Math.abs(diff), p.unit)}`}
                      {line && diff !== 0 && Number(p.unitPrice) > 0 && (
                        <div className="text-[11px] font-normal text-slate-400">{formatMoney(line.diffValue, CURRENCY)}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Button onClick={validate} disabled={saving || !lines.length} className="w-full py-3 h-auto text-sm font-semibold">
        {saving ? 'Enregistrement...' : <><Check size={17} /> Valider l'inventaire ({lines.length} produit(s) compté(s))</>}
      </Button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? '#059669' : tone === 'warn' ? '#d97706' : tone === 'bad' ? '#dc2626' : '#0f172a';
  return (
    <Card className="px-4 py-3">
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </Card>
  );
}
