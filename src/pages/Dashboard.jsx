import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Package, ArrowDownCircle, FileText, AlertTriangle, TrendingUp, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function Dashboard({ navigate }) {
  const products  = useLiveQuery(() => db.products.toArray(), []);
  const allMvts   = useLiveQuery(() => db.movements.toArray(), []);
  const bonsCount = useLiveQuery(() => db.bons.count(), []);

  const recent = useLiveQuery(
    () => db.movements.orderBy('date').reverse().limit(8).toArray(), []
  );

  const stockMap = useLiveQuery(async () => {
    const prods = await db.products.toArray();
    const mvts  = await db.movements.toArray();
    const map   = {};
    prods.forEach(p => { map[p.id] = { ...p, qty: Number(p.stockInitial) || 0 }; });
    mvts.forEach(m => {
      if (!map[m.productId]) return;
      if (m.type === 'entree') map[m.productId].qty += m.quantity;
      else                     map[m.productId].qty -= m.quantity;
    });
    return map;
  }, []);

  const prodMap = {};
  products?.forEach(p => { prodMap[p.id] = p; });

  const lowStock   = stockMap ? Object.values(stockMap).filter(p => p.minStock > 0 && p.qty <= p.minStock) : [];
  const emptyStock = stockMap ? Object.values(stockMap).filter(p => p.qty <= 0) : [];

  const sortiesCount = allMvts?.filter(m => m.type === 'sortie').length ?? 0;

  return (
    <div>
      {/* Titre */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Tableau de bord</h1>
        <p className="text-sm text-slate-500 mt-0.5">Vue d'ensemble de votre stock</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          icon={<Package size={18} />}
          label="Produits"
          value={products?.length ?? 0}
          sub="articles catalogués"
          accentColor="#4f46e5"
          onClick={() => navigate('products')}
        />
        <KpiCard
          icon={<ArrowDownCircle size={18} />}
          label="Sorties"
          value={sortiesCount}
          sub="mouvements sortants"
          accentColor="#f59e0b"
          onClick={() => navigate('bons')}
        />
        <KpiCard
          icon={<FileText size={18} />}
          label="Bons émis"
          value={bonsCount ?? 0}
          sub="bons de sortie"
          accentColor="#10b981"
          onClick={() => navigate('bons')}
        />
        <KpiCard
          icon={<AlertTriangle size={18} />}
          label="Stock faible"
          value={lowStock.length}
          sub={`dont ${emptyStock.length} épuisé(s)`}
          accentColor="#ef4444"
          alert={lowStock.length > 0}
          onClick={() => navigate('stock')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Alertes stock */}
        <div className="lg:col-span-1 space-y-3">
          {/* Stock faible */}
          {lowStock.length > 0 ? (
            <div className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: '#fcd34d' }}>
              <div className="px-5 py-3.5" style={{ background: '#fffbeb', borderBottom: '1px solid #fcd34d' }}>
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#92400e' }}>
                  <AlertTriangle size={14} />
                  {lowStock.length} article(s) en stock faible
                </div>
              </div>
              <div className="divide-y" style={{ divideColor: '#fef9c3' }}>
                {lowStock.slice(0, 5).map(p => (
                  <div key={p.id} className="flex items-center justify-between px-5 py-2.5">
                    <div>
                      <div className="text-sm font-medium text-slate-800 truncate max-w-[140px]">{p.name}</div>
                      {p.reference && <div className="text-xs text-slate-400">{p.reference}</div>}
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className="text-sm font-bold" style={{ color: p.qty <= 0 ? '#dc2626' : '#d97706' }}>
                        {p.qty} <span className="text-xs font-normal text-slate-400">{p.unit}</span>
                      </div>
                      <div className="text-xs text-slate-400">min {p.minStock}</div>
                    </div>
                  </div>
                ))}
                {lowStock.length > 5 && (
                  <div className="px-5 py-2 text-xs text-slate-400 text-center">
                    +{lowStock.length - 5} article(s) supplémentaire(s)
                  </div>
                )}
              </div>
              <div className="px-5 py-3" style={{ borderTop: '1px solid #fcd34d' }}>
                <button
                  onClick={() => navigate('stock')}
                  className="text-xs font-semibold flex items-center gap-1 hover:underline"
                  style={{ color: '#b45309' }}
                >
                  Voir les niveaux de stock <ArrowUpRight size={12} />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-100 p-5 text-center">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: '#d1fae5' }}>
                <TrendingUp size={18} style={{ color: '#059669' }} />
              </div>
              <p className="text-sm font-semibold text-slate-700">Stock en bonne santé</p>
              <p className="text-xs text-slate-400 mt-1">Aucun article en dessous du seuil</p>
            </div>
          )}

          {/* Accès rapide */}
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Accès rapide</p>
            <div className="space-y-2">
              <QuickAction
                label="Enregistrer une sortie"
                sub="Déduire du stock"
                color="#4f46e5"
                bg="#eef2ff"
                icon={<ArrowDownRight size={15} />}
                onClick={() => navigate('movement')}
              />
              <QuickAction
                label="Ajouter un produit"
                sub="Catalogue"
                color="#059669"
                bg="#d1fae5"
                icon={<Package size={15} />}
                onClick={() => navigate('products')}
              />
              <QuickAction
                label="Importer un fichier Excel"
                sub="PRESTINFO / personnalisé"
                color="#d97706"
                bg="#fef3c7"
                icon={<FileText size={15} />}
                onClick={() => navigate('import')}
              />
            </div>
          </div>
        </div>

        {/* Derniers mouvements */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <h2 className="font-semibold text-slate-800 text-sm">Derniers mouvements</h2>
            <button
              onClick={() => navigate('bons')}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              style={{ color: '#4f46e5', background: '#eef2ff' }}
            >
              Voir tout
            </button>
          </div>

          {!recent?.length ? (
            <div className="py-14 text-center">
              <ArrowDownCircle size={32} className="mx-auto mb-3 text-slate-200" />
              <p className="text-slate-400 text-sm">Aucun mouvement enregistré</p>
              <button
                onClick={() => navigate('movement')}
                className="mt-4 text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90"
                style={{ background: '#4f46e5' }}
              >
                Enregistrer une sortie
              </button>
            </div>
          ) : (
            <>
              {/* Table header */}
              <div
                className="grid px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400"
                style={{ gridTemplateColumns: '1fr 100px 80px 80px', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}
              >
                <span>Produit</span>
                <span>N° Bon</span>
                <span className="text-center">Type</span>
                <span className="text-right">Quantité</span>
              </div>

              <div className="divide-y divide-slate-50">
                {recent?.map(m => {
                  const prod     = prodMap[m.productId];
                  const isSortie = m.type === 'sortie';
                  return (
                    <div
                      key={m.id}
                      className="grid items-center px-5 py-3 hover:bg-slate-50/60 transition-colors"
                      style={{ gridTemplateColumns: '1fr 100px 80px 80px' }}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-sm font-medium text-slate-800 truncate">{prod?.name ?? '—'}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{m.date?.slice(0, 10)}</div>
                      </div>
                      <div className="text-xs font-mono text-slate-400 truncate">{m.bonNumber || '—'}</div>
                      <div className="flex justify-center">
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
                          style={isSortie
                            ? { background: '#fee2e2', color: '#b91c1c' }
                            : { background: '#d1fae5', color: '#065f46' }
                          }
                        >
                          {isSortie ? 'Sortie' : 'Entrée'}
                        </span>
                      </div>
                      <div
                        className="text-sm font-bold text-right"
                        style={{ color: isSortie ? '#dc2626' : '#059669' }}
                      >
                        {isSortie ? '−' : '+'}{m.quantity}
                        <span className="text-xs font-normal text-slate-400 ml-1">{prod?.unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, accentColor, alert, onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-100 text-left w-full overflow-hidden hover:shadow-md transition-shadow"
    >
      <div style={{ height: 3, background: accentColor }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div
              className="text-3xl font-bold tracking-tight"
              style={{ color: alert && value > 0 ? accentColor : '#0f172a' }}
            >
              {value}
            </div>
            <div className="text-sm font-semibold text-slate-600 mt-1">{label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
          </div>
          <div
            className="p-2.5 rounded-xl shrink-0"
            style={{ background: accentColor + '18', color: accentColor }}
          >
            {icon}
          </div>
        </div>
      </div>
    </button>
  );
}

function QuickAction({ label, sub, color, bg, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-transparent hover:border-slate-200 transition-colors text-left"
      style={{ background: bg + '80' }}
    >
      <div className="p-2 rounded-lg shrink-0" style={{ background: bg, color }}>
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-800">{label}</div>
        <div className="text-xs text-slate-400">{sub}</div>
      </div>
      <ArrowUpRight size={14} className="ml-auto text-slate-300 shrink-0" />
    </button>
  );
}
