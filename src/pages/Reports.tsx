import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { computeStockLevels, formatMoney, formatQty } from '@/lib/stock';
import {
  consumptionByDestination, dormantProducts, flowsByProduct, inPeriod, periodPresets, type Period,
} from '@/lib/reports';
import { Download, Info, PieChart } from 'lucide-react';
import type { NavigateFn } from '../types';
import { CURRENCY } from '../config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

const DORMANT_CHOICES = [30, 60, 90, 180, 365];
const TOP = 15;

const money = (v: number) => formatMoney(v, CURRENCY);

export default function Reports({ navigate }: { navigate: NavigateFn }) {
  const presets = useMemo(() => periodPresets(), []);
  const [period, setPeriod] = useState<Period>(presets[0].period);
  const [dormantDays, setDormantDays] = useState(90);
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  const data = useLiveQuery(async () => {
    const [products, movements, bons] = await Promise.all([db.products.toArray(), db.movements.toArray(), db.bons.toArray()]);
    return { products, movements, bons, levels: computeStockLevels(products, movements) };
  }, []);

  const report = useMemo(() => {
    if (!data) return null;
    const { products, movements, bons, levels } = data;
    const byId = new Map(levels.map(p => [p.id, p]));
    const bonsById = new Map(bons.map(b => [b.id, b]));
    const sorties = flowsByProduct('sortie', movements, bons, products, period);
    const entrees = flowsByProduct('entree', movements, bons, products, period);
    const destinations = consumptionByDestination(movements, bons, products, period);
    const dormant = dormantProducts(levels, movements, dormantDays);

    // Valeur du stock par famille.
    const familyMap = new Map<string, { count: number; value: number }>();
    for (const p of levels) {
      const key = p.category || '(sans famille)';
      const row = familyMap.get(key) ?? { count: 0, value: 0 };
      row.count++;
      row.value += p.value;
      familyMap.set(key, row);
    }
    const families = [...familyMap].map(([family, r]) => ({ family, ...r })).sort((a, b) => b.value - a.value);

    // Activité par utilisateur sur la période (traçabilité).
    const userMap = new Map<string, { sorties: number; entrees: number; ajustements: number }>();
    for (const m of movements) {
      if (!inPeriod(m.date, period)) continue;
      const key = m.createdBy || '(inconnu)';
      const row = userMap.get(key) ?? { sorties: 0, entrees: 0, ajustements: 0 };
      if (m.bonId != null && bonsById.get(m.bonId)?.type === 'inventaire') row.ajustements++;
      else if (m.type === 'sortie') row.sorties++;
      else row.entrees++;
      userMap.set(key, row);
    }
    const users = [...userMap].map(([user, r]) => ({ user, ...r }))
      .sort((a, b) => (b.sorties + b.entrees + b.ajustements) - (a.sorties + a.entrees + a.ajustements));

    return {
      byId, sorties, entrees, destinations, dormant, families, users,
      stockValue: levels.reduce((s, p) => s + p.value, 0),
      sortiesValue: sorties.reduce((s, r) => s + r.value, 0),
      entreesValue: entrees.reduce((s, r) => s + r.value, 0),
      dormantValue: dormant.reduce((s, d) => s + d.product.value, 0),
      hasPrices: levels.some(p => Number(p.unitPrice) > 0),
    };
  }, [data, period, dormantDays]);

  async function exportExcel() {
    if (!report) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const name = (id: number) => report.byId.get(id)?.name ?? '';
      const ref  = (id: number) => report.byId.get(id)?.reference ?? '';
      const unit = (id: number) => report.byId.get(id)?.unit ?? '';
      const wb = XLSX.utils.book_new();
      const add = (rows: Record<string, unknown>[], sheet: string) =>
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'Aucune donnée' }]), sheet);
      add([
        { Indicateur: 'Période', Valeur: `${period.from} → ${period.to}` },
        { Indicateur: 'Valeur du stock (actuelle)', Valeur: round2(report.stockValue) },
        { Indicateur: 'Sorties de la période (valeur)', Valeur: round2(report.sortiesValue) },
        { Indicateur: 'Entrées de la période (valeur)', Valeur: round2(report.entreesValue) },
        { Indicateur: `Stock dormant > ${dormantDays} j (valeur)`, Valeur: round2(report.dormantValue) },
      ], 'Synthèse');
      add(report.sorties.map(r => ({ Réf: ref(r.productId), Libellé: name(r.productId), Unité: unit(r.productId), Quantité: r.quantity, Valeur: round2(r.value), Mouvements: r.count })), 'Consommation');
      add(report.destinations.map(d => ({ Destination: d.destination, Bons: d.bons, Valeur: round2(d.value) })), 'Destinations');
      add(report.entrees.map(r => ({ Réf: ref(r.productId), Libellé: name(r.productId), Unité: unit(r.productId), Quantité: r.quantity, Valeur: round2(r.value) })), 'Entrées');
      add(report.dormant.map(d => ({
        Réf: d.product.reference, Libellé: d.product.name, Stock: d.product.qty, Unité: d.product.unit,
        Valeur: round2(d.product.value), 'Dernier mouvement': d.lastMovement?.slice(0, 10) ?? 'jamais',
      })), 'Dormants');
      add(report.families.map(f => ({ Famille: f.family, Produits: f.count, Valeur: round2(f.value) })), 'Valeur par famille');
      add(report.users.map(u => ({ Utilisateur: u.user, Sorties: u.sorties, Entrées: u.entrees, 'Ajustements inventaire': u.ajustements })), 'Par utilisateur');
      XLSX.writeFile(wb, `rapport_${period.from}_${period.to}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  if (!report) return <div className="p-8 text-center text-slate-400 text-sm">Chargement...</div>;
  const name = (id: number) => report.byId.get(id)?.name ?? '—';
  const unitOf = (id: number) => report.byId.get(id)?.unit;
  const sorties = showAll ? report.sorties : report.sorties.slice(0, TOP);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Rapports</h1>
          <p className="text-sm text-slate-500 mt-0.5">Valeur du stock, consommation, stock dormant et activité par utilisateur</p>
        </div>
        <Button variant="outline" onClick={exportExcel} disabled={exporting}>
          <Download size={15} /> {exporting ? 'Export...' : 'Exporter en Excel'}
        </Button>
      </div>

      {/* Période */}
      <Card className="p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {presets.map(p => {
            const active = p.period.from === period.from && p.period.to === period.to;
            return (
              <button
                key={p.key}
                onClick={() => setPeriod(p.period)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${active ? 'bg-indigo-600 text-white' : 'text-slate-500 bg-slate-50 hover:bg-slate-100'}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          Du <Input type="date" value={period.from} max={period.to} onChange={e => e.target.value && setPeriod(p => ({ ...p, from: e.target.value }))} className="h-8 w-36" />
          au <Input type="date" value={period.to} min={period.from} onChange={e => e.target.value && setPeriod(p => ({ ...p, to: e.target.value }))} className="h-8 w-36" />
        </div>
      </Card>

      {!report.hasPrices && (
        <div className="mb-4 flex items-start gap-2 text-sm text-indigo-800 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
          <Info size={16} className="shrink-0 mt-0.5" />
          <span>
            Aucun prix unitaire n'est renseigné : les valeurs restent à zéro. Ajoutez les prix dans{' '}
            <button onClick={() => navigate('products')} className="underline font-semibold">Produits</button> ou par import Excel (colonne « Prix unitaire »).
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Valeur du stock" sub="aujourd'hui" value={money(report.stockValue)} color="#4f46e5" />
        <Kpi label="Sorties" sub={`${report.sorties.reduce((s, r) => s + r.count, 0)} mouvement(s) sur la période`} value={money(report.sortiesValue)} color="#d97706" />
        <Kpi label="Entrées" sub="réceptions de la période" value={money(report.entreesValue)} color="#059669" />
        <Kpi label="Stock dormant" sub={`${report.dormant.length} produit(s) sans mouvement > ${dormantDays} j`} value={money(report.dormantValue)} color="#dc2626" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Consommation par produit" hint="Sorties de la période, hors ajustements d'inventaire">
          {!report.sorties.length ? <Empty /> : (
            <>
              <Table head={['Produit', 'Quantité', 'Valeur', 'Mvts']}>
                {sorties.map(r => (
                  <tr key={r.productId} className="border-b border-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{name(r.productId)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatQty(r.quantity, unitOf(r.productId))}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap font-semibold">{money(r.value)}</td>
                    <td className="px-4 py-2 text-right text-slate-400">{r.count}</td>
                  </tr>
                ))}
              </Table>
              {report.sorties.length > TOP && (
                <button onClick={() => setShowAll(s => !s)} className="w-full py-2 text-xs text-indigo-600 hover:underline">
                  {showAll ? 'Afficher moins' : `Afficher les ${report.sorties.length} produits`}
                </button>
              )}
            </>
          )}
        </Section>

        <Section title="Consommation par destination" hint="Bons de sortie de la période">
          {!report.destinations.length ? <Empty /> : (
            <Table head={['Destination', 'Bons', 'Valeur']}>
              {report.destinations.map(d => (
                <tr key={d.destination} className="border-b border-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{d.destination}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{d.bons}</td>
                  <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{money(d.value)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section
          title="Stock dormant"
          hint="Produits en stock sans aucun mouvement depuis"
          action={(
            <select
              value={dormantDays}
              onChange={e => setDormantDays(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
              aria-label="Durée sans mouvement"
            >
              {DORMANT_CHOICES.map(d => <option key={d} value={d}>{d} jours</option>)}
            </select>
          )}
        >
          {!report.dormant.length ? <Empty text="Aucun produit dormant." /> : (
            <Table head={['Produit', 'Stock', 'Valeur', 'Dernier mvt']}>
              {report.dormant.slice(0, 30).map(d => (
                <tr key={d.product.id} className="border-b border-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{d.product.name}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">{formatQty(d.product.qty, d.product.unit)}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap font-semibold">{money(d.product.value)}</td>
                  <td className="px-4 py-2 text-right text-xs text-slate-400 whitespace-nowrap">
                    {d.lastMovement ? new Date(d.lastMovement).toLocaleDateString('fr-FR') : 'jamais'}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="Valeur du stock par famille" hint="Au prix unitaire actuel">
          {!report.families.length ? <Empty /> : (
            <Table head={['Famille', 'Produits', 'Valeur']}>
              {report.families.map(f => (
                <tr key={f.family} className="border-b border-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{f.family}</td>
                  <td className="px-2 py-2 text-right text-slate-500">{f.count}</td>
                  <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{money(f.value)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title="Activité par utilisateur" hint="Mouvements saisis sur la période">
          {!report.users.length ? <Empty /> : (
            <Table head={['Utilisateur', 'Sorties', 'Entrées', 'Inventaire']}>
              {report.users.map(u => (
                <tr key={u.user} className="border-b border-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{u.user}</td>
                  <td className="px-2 py-2 text-right">{u.sorties}</td>
                  <td className="px-2 py-2 text-right">{u.entrees}</td>
                  <td className="px-4 py-2 text-right">{u.ajustements}</td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>

      <p className="mt-5 text-xs text-slate-400">
        Les montants sont calculés avec le prix unitaire actuel de chaque produit.
      </p>
    </div>
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function Kpi({ label, sub, value, color }: { label: string; sub: string; value: string; color: string }) {
  return (
    <Card className="overflow-hidden">
      <div style={{ height: 3, background: color }} />
      <div className="p-4">
        <div className="text-xl font-bold text-slate-900 truncate" title={value}>{value}</div>
        <div className="text-sm font-semibold text-slate-600 mt-0.5">{label}</div>
        <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
      </div>
    </Card>
  );
}

function Section({ title, hint, action, children }: { title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <p className="text-xs text-slate-400">{hint}</p>
        </div>
        {action}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
          {head.map((h, i) => (
            <th key={h} className={`font-semibold py-2 ${i === 0 ? 'text-left px-4' : i === head.length - 1 ? 'text-right px-4' : 'text-right px-2'}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Empty({ text = 'Aucune donnée sur la période.' }: { text?: string }) {
  return (
    <div className="py-8 text-center text-sm text-slate-400">
      <PieChart size={24} className="mx-auto mb-2 text-slate-200" />
      {text}
    </div>
  );
}
