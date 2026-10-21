import { useLiveQuery } from 'dexie-react-hooks';
import { db, base64ToBlob, deleteBon as removeBon } from '../db';
import { FileText, ChevronRight, Search, Paperclip, Download, Trash2, Eye, Plus, AlertTriangle } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import { duplicateBonNumbers, ordersWithProgress } from '@/lib/stock';
import { bonTypeInfo, ORDER_STATUS } from '@/lib/bons';
import type { NavigateFn } from '../types';
import type { Bon, BonType } from '../../shared/schemas';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface BonsProps {
  navigate: NavigateFn;
}

export default function Bons({ navigate }: BonsProps) {
  const bons = useLiveQuery(() => db.bons.orderBy('date').reverse().toArray(), []);
  const bonItems = useLiveQuery(() => db.bonItems.toArray(), []);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | BonType>('all');
  const [userFilter, setUserFilter] = useState('');
  const duplicates = useMemo(() => duplicateBonNumbers(bons ?? []), [bons]);
  const orderStatus = useMemo(
    () => new Map(ordersWithProgress(bons ?? [], bonItems ?? []).map(o => [o.order.id, o.status])),
    [bons, bonItems]
  );
  const users = useMemo(() => [...new Set((bons ?? []).map(b => b.createdBy).filter(Boolean) as string[])].sort(), [bons]);

  const q = search.trim().toLowerCase();
  const filtered = bons
    ?.filter(b => typeFilter === 'all' || (b.type || 'sortie') === typeFilter)
    .filter(b => !userFilter || b.createdBy === userFilter)
    .filter(b =>
    (b.number || '').toLowerCase().includes(q) ||
    (b.destination || '').toLowerCase().includes(q) ||
    (b.note || '').toLowerCase().includes(q) ||
    (b.fileName || '').toLowerCase().includes(q)
  );

  async function deleteBon(e: MouseEvent, bon: Bon) {
    e.stopPropagation();
    if (!confirm(`Supprimer le bon ${bon.number} ?\n\n${bonTypeInfo(bon.type).deleteEffect}`)) return;
    await removeBon(bon);
  }

  function openFile(e: MouseEvent, bon: Bon) {
    e.stopPropagation();
    const blob = base64ToBlob(bon.fileData!, bon.fileType);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  function downloadFile(e: MouseEvent, bon: Bon) {
    e.stopPropagation();
    const blob = base64ToBlob(bon.fileData!, bon.fileType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bon.fileName || 'fichier';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bons</h1>
          <p className="text-sm text-slate-500 mt-0.5">{bons?.length ?? 0} bon(s) enregistré(s)</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <Input
            placeholder="Rechercher par n° bon, destination, fournisseur, observation..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {users.length > 1 && (
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-600"
            aria-label="Filtrer par utilisateur"
          >
            <option value="">Tous les utilisateurs</option>
            {users.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}
        <div className="flex gap-1.5 p-1 rounded-xl border border-slate-100 bg-white overflow-x-auto">
          {([['all', 'Tous'], ['sortie', 'Sorties'], ['entree', 'Réceptions'], ['commande', 'Commandes'], ['inventaire', 'Inventaires']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${typeFilter === key ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {duplicates.size > 0 && (
        <div className="mb-4 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>
            Numéro(s) attribué(s) à plusieurs bons : {[...duplicates].join(', ')}. Cela arrive quand deux postes
            hors-ligne créent un bon en même temps. Les bons restent distincts ; précisez lequel en cas de doute.
          </span>
        </div>
      )}

      <div className="space-y-2">
        {filtered?.length === 0 && (
          <Card className="p-10 text-center">
            <FileText size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-slate-400 text-sm">
              {bons?.length ? 'Aucun bon ne correspond à cette recherche' : 'Aucun bon enregistré'}
            </p>
            {!bons?.length && (
              <Button className="mt-4" size="sm" onClick={() => navigate('movement')}>
                <Plus size={14} /> Nouvelle sortie
              </Button>
            )}
          </Card>
        )}

        {filtered?.map(bon => (
          <Card
            key={bon.id}
            onClick={() => navigate('bon-detail', { bonId: bon.id })}
            className="px-4 py-3.5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: bon.fileData ? '#eef2ff' : '#f8fafc', color: bon.fileData ? '#4f46e5' : '#94a3b8' }}
                >
                  {bon.fileData ? <Paperclip size={16} /> : <FileText size={16} />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-sm" style={{ color: '#4f46e5' }}>{bon.number}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${bonTypeInfo(bon.type).badgeClass}`}>
                      {bonTypeInfo(bon.type).label}
                    </span>
                    {orderStatus.has(bon.id) && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${ORDER_STATUS[orderStatus.get(bon.id)!].className}`}>
                        {ORDER_STATUS[orderStatus.get(bon.id)!].label}
                      </span>
                    )}
                    {duplicates.has(bon.number) && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-red-100 text-red-700">N° en double</span>
                    )}
                    <span className="text-xs text-slate-400">
                      {new Date(bon.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      {' '}
                      {new Date(bon.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      {bon.createdBy && <> · par {bon.createdBy}</>}
                    </span>
                  </div>

                  {bon.destination && (
                    <div className="text-xs font-medium text-slate-600 mt-0.5">{bon.destination}</div>
                  )}
                  {bon.note && (
                    <div className="text-xs text-slate-400 mt-0.5 italic">{bon.note}</div>
                  )}

                  {bon.fileData && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className="text-xs font-mono px-2 py-0.5 rounded truncate max-w-[180px]"
                        style={{ background: '#eef2ff', color: '#4f46e5' }}
                      >
                        {bon.fileName}
                      </span>
                      <button
                        onClick={e => openFile(e, bon)}
                        className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                      >
                        <Eye size={12} /> Ouvrir
                      </button>
                      <button
                        onClick={e => downloadFile(e, bon)}
                        className="text-slate-400 hover:text-indigo-600 transition-colors"
                      >
                        <Download size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={e => deleteBon(e, bon)}
                  title="Supprimer le bon"
                  aria-label={`Supprimer le bon ${bon.number}`}
                  className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
                <ChevronRight size={16} className="text-slate-300" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
