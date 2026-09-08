import { useLiveQuery } from 'dexie-react-hooks';
import { db, base64ToBlob } from '../db';
import { FileText, ChevronRight, Search, Paperclip, Download, Trash2, Eye } from 'lucide-react';
import { useState } from 'react';

export default function Bons({ navigate }) {
  const bons = useLiveQuery(() => db.bons.orderBy('date').reverse().toArray(), []);
  const [search, setSearch] = useState('');

  const filtered = bons?.filter(b =>
    (b.number || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.destination || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.note || '').toLowerCase().includes(search.toLowerCase()) ||
    (b.fileName || '').toLowerCase().includes(search.toLowerCase())
  );

  async function deleteBon(e, bon) {
    e.stopPropagation();
    if (!confirm(`Supprimer le bon ${bon.number} et ses mouvements ?`)) return;
    await db.bonItems.where('bonId').equals(bon.id).delete();
    await db.movements.where('bonNumber').equals(bon.number).delete();
    await db.bons.delete(bon.id);
  }

  function openFile(e, bon) {
    e.stopPropagation();
    const blob = base64ToBlob(bon.fileData, bon.fileType);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  function downloadFile(e, bon) {
    e.stopPropagation();
    const blob = base64ToBlob(bon.fileData, bon.fileType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bon.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bons de sortie</h1>
          <p className="text-sm text-slate-500 mt-0.5">{bons?.length ?? 0} bon(s) enregistré(s)</p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
        <input
          placeholder="Rechercher par n° bon, destination, observation..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      <div className="space-y-2">
        {filtered?.length === 0 && (
          <div className="bg-white rounded-xl p-10 text-center border border-slate-100">
            <FileText size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-slate-400 text-sm">Aucun bon enregistré</p>
          </div>
        )}

        {filtered?.map(bon => (
          <div
            key={bon.id}
            onClick={() => navigate('bon-detail', { bonId: bon.id })}
            className="bg-white rounded-xl px-4 py-3.5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
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
                    <span className="text-xs text-slate-400">
                      {new Date(bon.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      {' '}
                      {new Date(bon.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
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
                  className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
                <ChevronRight size={16} className="text-slate-300" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
