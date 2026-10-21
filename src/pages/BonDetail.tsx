import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, base64ToBlob, deleteBon as removeBon } from '../db';
import { useReactToPrint } from 'react-to-print';
import { Printer, ArrowLeft, Trash2, Download, Eye, FileText, Image, PackageCheck } from 'lucide-react';
import type { NavigateFn } from '../types';
import type { Product } from '../../shared/schemas';
import { bonTypeInfo, ORDER_STATUS } from '@/lib/bons';
import { formatMoney, formatQty, orderProgress } from '@/lib/stock';
import { receptionDraft, replaceDraft } from '@/lib/drafts';
import { CURRENCY } from '../config';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface BonDetailProps {
  bonId: number | null;
  navigate: NavigateFn;
}

export default function BonDetail({ bonId, navigate }: BonDetailProps) {
  // undefined = chargement en cours, null = bon introuvable (supprimé, lien obsolète…)
  const bon      = useLiveQuery(async () => (bonId ? await db.bons.get(bonId) : undefined) ?? null, [bonId]);
  const items    = useLiveQuery(() => bonId ? db.bonItems.where('bonId').equals(bonId).toArray() : [], [bonId]);
  const products = useLiveQuery(() => db.products.toArray(), []);
  // Commande : réceptions qui la soldent ; réception : commande d'origine.
  const linked = useLiveQuery(async () => {
    if (!bon) return null;
    if (bon.type === 'commande' && bon.uid) {
      const receptions = await db.bons.where('orderUid').equals(bon.uid).sortBy('date');
      const ids = receptions.map(r => r.id!);
      const receivedItems = ids.length ? await db.bonItems.where('bonId').anyOf(ids).toArray() : [];
      return { receptions, receivedItems, order: undefined };
    }
    if (bon.type === 'entree' && bon.orderUid) {
      return { receptions: [], receivedItems: [], order: await db.bons.where('uid').equals(bon.orderUid).first() };
    }
    return null;
  }, [bon]);
  const printRef = useRef<HTMLDivElement>(null);

  const prodMap: Record<number, Product> = {};
  products?.forEach(p => { if (p.id != null) prodMap[p.id] = p; });

  const handlePrint = useReactToPrint({ contentRef: printRef });

  async function deleteBon() {
    if (!bon) return;
    if (!confirm(`Supprimer le bon ${bon.number} ?\n\n${bonTypeInfo(bon.type).deleteEffect}`)) return;
    await removeBon(bon);
    navigate('bons');
  }

  function openFile() {
    if (!bon?.fileData) return;
    const blob = base64ToBlob(bon.fileData, bon.fileType);
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  function downloadFile() {
    if (!bon?.fileData) return;
    const blob = base64ToBlob(bon.fileData, bon.fileType);
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = bon.fileName || 'fichier';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (bon === undefined) return <div className="p-8 text-center text-slate-400 text-sm">Chargement...</div>;
  if (bon === null) {
    return (
      <div className="p-8 text-center">
        <p className="text-slate-500 text-sm mb-4">Ce bon n'existe pas ou a été supprimé.</p>
        <Button variant="outline" onClick={() => navigate('bons')}>
          <ArrowLeft size={15} /> Retour aux bons
        </Button>
      </div>
    );
  }

  const fileIsImage = bon.fileType?.startsWith('image/');
  const info        = bonTypeInfo(bon.type);
  const isCommande  = bon.type === 'commande';
  const isInventory = bon.type === 'inventaire';
  const progress    = isCommande && items ? orderProgress(items, linked?.receivedItems ?? []) : null;
  const receivedBy  = new Map(progress?.lines.map(l => [l.productId, l]) ?? []);
  const priced      = isCommande && !!items?.some(i => Number(prodMap[i.productId]?.unitPrice) > 0);
  const orderTotal  = priced ? (items ?? []).reduce((s, i) => s + i.quantity * (Number(prodMap[i.productId]?.unitPrice) || 0), 0) : 0;
  const SECOND_SIGNATURE: Record<string, string> = {
    entree: 'Signature livreur', commande: 'Cachet fournisseur', inventaire: 'Signature contrôleur',
  };

  function receive() {
    if (!bon || !progress) return;
    if (replaceDraft('entree', receptionDraft(bon, progress.lines))) navigate('entree');
  }

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
          {progress && progress.status !== 'recue' && (
            <Button variant="outline" onClick={receive}>
              <PackageCheck size={15} /> Réceptionner
            </Button>
          )}
          <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-600" onClick={deleteBon}>
            <Trash2 size={15} /> Supprimer
          </Button>
          <Button onClick={() => handlePrint()}>
            <Printer size={15} /> Imprimer
          </Button>
        </div>
      </div>

      {/* Zone imprimable */}
      <div ref={printRef} className="bg-white rounded-xl border border-slate-100 shadow-sm p-8 print:shadow-none print:rounded-none print:border-0">

        {/* En-tête */}
        <div className="flex items-start justify-between pb-6 mb-6" style={{ borderBottom: '2px solid #0f172a' }}>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{info.title}</h1>
            <p className="text-slate-400 text-sm mt-1">
              Gestion des stocks{bon.createdBy && <> · saisi par <span className="text-slate-600">{bon.createdBy}</span></>}
            </p>
            {progress && (
              <span className={`inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${ORDER_STATUS[progress.status].className}`}>
                {ORDER_STATUS[progress.status].label}
              </span>
            )}
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
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{info.partyLabel}</div>
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
              {isInventory && <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider">Théorique</th>}
              <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider">{isInventory ? 'Compté' : 'Qté'}</th>
              {isInventory && <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider">Écart</th>}
              {isCommande && <th className="text-center px-4 py-3 font-semibold text-xs uppercase tracking-wider no-print">Reçue</th>}
              {priced && (
                <>
                  <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider">P.U.</th>
                  <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider">Montant</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items?.map((item, i) => {
              const p = prodMap[item.productId];
              const diff = item.expected != null ? parseFloat((item.quantity - item.expected).toFixed(3)) : 0;
              const got = receivedBy.get(item.productId);
              return (
                <tr key={item.id} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                  <td className="px-4 py-3 text-slate-400">{p?.reference || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{p?.name || '—'}</div>
                    {item.note && <div className="text-xs text-slate-400 mt-0.5 italic">{item.note}</div>}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-500">{p?.unit || '—'}</td>
                  {isInventory && <td className="px-4 py-3 text-center text-slate-500">{item.expected != null ? formatQty(item.expected) : '—'}</td>}
                  <td className="px-4 py-3 text-center font-bold text-slate-900">{formatQty(item.quantity)}</td>
                  {isInventory && (
                    <td className={`px-4 py-3 text-center font-semibold ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {item.expected == null ? '—' : diff === 0 ? 'OK' : `${diff > 0 ? '+' : '−'}${formatQty(Math.abs(diff))}`}
                    </td>
                  )}
                  {isCommande && (
                    <td className={`px-4 py-3 text-center no-print ${got && got.remaining <= 0 ? 'text-emerald-600 font-semibold' : 'text-slate-500'}`}>
                      {got ? formatQty(got.received) : '0'}
                    </td>
                  )}
                  {priced && (
                    <>
                      <td className="px-4 py-3 text-right text-slate-500">{formatMoney(Number(p?.unitPrice) || 0)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatMoney(item.quantity * (Number(p?.unitPrice) || 0))}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {priced && (
          <div className="flex justify-end -mt-4 mb-8 text-sm">
            <span className="text-slate-500 mr-4 uppercase text-xs font-semibold tracking-wider self-center">Total</span>
            <span className="font-bold text-slate-900">{formatMoney(orderTotal, CURRENCY)}</span>
          </div>
        )}

        {(linked?.order || !!linked?.receptions.length) && (
          <div className="mb-6 text-sm text-slate-600 no-print">
            {linked.order && (
              <>Réception de la commande{' '}
                <button onClick={() => navigate('bon-detail', { bonId: linked.order!.id })} className="font-semibold text-indigo-600 hover:underline">{linked.order.number}</button>
              </>
            )}
            {!!linked.receptions.length && (
              <>Réception(s) :{' '}
                {linked.receptions.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ', '}
                    <button onClick={() => navigate('bon-detail', { bonId: r.id })} className="font-semibold text-indigo-600 hover:underline">{r.number}</button>
                    <span className="text-slate-400"> du {new Date(r.date).toLocaleDateString('fr-FR')}</span>
                  </span>
                ))}
              </>
            )}
          </div>
        )}

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-10 pt-6" style={{ borderTop: '1px solid #e2e8f0' }}>
          <div className="text-center">
            <p className="text-xs text-slate-400 mb-12">Signature responsable stock</p>
            <div style={{ borderTop: '1px solid #94a3b8' }} className="pt-1">
              <span className="text-xs text-slate-300">Nom et signature</span>
            </div>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-400 mb-12">{SECOND_SIGNATURE[bon.type] ?? 'Signature demandeur'}</p>
            <div style={{ borderTop: '1px solid #94a3b8' }} className="pt-1">
              <span className="text-xs text-slate-300">Nom et signature</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pièce jointe (hors zone imprimable) */}
      {bon.fileData && (
        <Card className="mt-4 shadow-sm p-5 no-print">
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
        </Card>
      )}
    </div>
  );
}
