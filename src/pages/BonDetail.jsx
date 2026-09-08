import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, base64ToBlob } from '../db';
import { useReactToPrint } from 'react-to-print';
import { Printer, ArrowLeft, Trash2, Download, Eye, FileText, Image } from 'lucide-react';

export default function BonDetail({ bonId, navigate }) {
  const bon      = useLiveQuery(() => bonId ? db.bons.get(bonId) : null, [bonId]);
  const items    = useLiveQuery(() => bonId ? db.bonItems.where('bonId').equals(bonId).toArray() : [], [bonId]);
  const products = useLiveQuery(() => db.products.toArray(), []);
  const printRef = useRef();

  const prodMap = {};
  products?.forEach(p => { prodMap[p.id] = p; });

  const handlePrint = useReactToPrint({ contentRef: printRef });

  async function deleteBon() {
    if (!confirm('Supprimer ce bon définitivement ?')) return;
    await db.bonItems.where('bonId').equals(bonId).delete();
    await db.movements.where('bonNumber').equals(bon.number).delete();
    await db.bons.delete(bonId);
    navigate('bons');
  }

  function openFile() {
    const blob = base64ToBlob(bon.fileData, bon.fileType);
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  function downloadFile() {
    const blob = base64ToBlob(bon.fileData, bon.fileType);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = bon.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!bon) return <div className="p-8 text-center text-slate-400 text-sm">Chargement...</div>;

  const fileIsImage = bon.fileType?.startsWith('image/');

  return (
    <div>
      {/* Barre d'actions (hors impression) */}
      <div className="flex items-center justify-between mb-6 no-print">
        <button
          onClick={() => navigate('bons')}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={16} /> Retour aux bons
        </button>
        <div className="flex gap-2">
          <button
            onClick={deleteBon}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={15} /> Supprimer
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white font-medium hover:opacity-90 transition-opacity"
            style={{ background: '#4f46e5' }}
          >
            <Printer size={15} /> Imprimer
          </button>
        </div>
      </div>

      {/* Zone imprimable */}
      <div ref={printRef} className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 print:shadow-none print:rounded-none print:border-0">

        {/* En-tête */}
        <div className="flex items-start justify-between pb-6 mb-6" style={{ borderBottom: '2px solid #0f172a' }}>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">BON DE SORTIE</h1>
            <p className="text-slate-400 text-sm mt-1">Gestion des stocks</p>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold" style={{ color: '#4f46e5' }}>{bon.number}</div>
            <div className="text-sm text-slate-500 mt-1">
              {new Date(bon.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
          </div>
        </div>

        {/* Infos destination / note */}
        {(bon.destination || bon.note) && (
          <div className="grid grid-cols-2 gap-6 mb-6 p-4 rounded-lg" style={{ background: '#f8fafc' }}>
            {bon.destination && (
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Destination</div>
                <div className="font-medium text-slate-800">{bon.destination}</div>
              </div>
            )}
            {bon.note && (
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Observation</div>
                <div className="font-medium text-slate-800">{bon.note}</div>
              </div>
            )}
          </div>
        )}

        {/* Tableau des produits */}
        <table className="w-full mb-8 text-sm">
          <thead>
            <tr style={{ background: '#0f172a', color: 'white' }}>
              <th className="text-left px-4 py-3 font-semibold rounded-tl-lg text-xs uppercase tracking-wider">Réf.</th>
              <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider">Désignation</th>
              <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider">Unité</th>
              <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider rounded-tr-lg">Qté</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((item, i) => {
              const p = prodMap[item.productId];
              return (
                <tr key={item.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                  <td className="px-4 py-3 text-slate-400">{p?.reference || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{p?.name || '—'}</div>
                    {item.note && <div className="text-xs text-slate-400 mt-0.5 italic">{item.note}</div>}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">{p?.unit || '—'}</td>
                  <td className="px-4 py-3 text-center font-bold text-slate-900">{item.quantity}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-10 pt-6" style={{ borderTop: '1px solid #e2e8f0' }}>
          <div className="text-center">
            <p className="text-xs text-slate-400 mb-12">Signature responsable stock</p>
            <div style={{ borderTop: '1px solid #94a3b8' }} className="pt-1">
              <span className="text-xs text-slate-300">Nom et signature</span>
            </div>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-400 mb-12">Signature demandeur</p>
            <div style={{ borderTop: '1px solid #94a3b8' }} className="pt-1">
              <span className="text-xs text-slate-300">Nom et signature</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pièce jointe (hors zone imprimable) */}
      {bon.fileData && (
        <div className="mt-4 bg-white rounded-xl border border-slate-100 shadow-sm p-5 no-print">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Pièce jointe</h2>
          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-indigo-100" style={{ background: '#eef2ff' }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <span style={{ color: '#4f46e5' }}>
                {fileIsImage ? <Image size={15} /> : <FileText size={15} />}
              </span>
              <span className="text-sm font-medium text-slate-700 truncate">{bon.fileName}</span>
            </div>
            <div className="flex items-center gap-2 ml-3 shrink-0">
              <button
                onClick={openFile}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"
              >
                <Eye size={13} /> Ouvrir
              </button>
              <button
                onClick={downloadFile}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
              >
                <Download size={13} /> Télécharger
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
