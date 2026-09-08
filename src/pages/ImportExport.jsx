import { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import * as XLSX from 'xlsx';
import { Upload, Download, FileSpreadsheet, Check, AlertCircle, Info } from 'lucide-react';

// Résout une valeur depuis plusieurs noms de colonnes possibles
function col(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
  }
  return '';
}

export default function ImportExport() {
  const products  = useLiveQuery(() => db.products.toArray(), []);
  const movements = useLiveQuery(() => db.movements.toArray(), []);
  const bons      = useLiveQuery(() => db.bons.toArray(), []);
  const bonItems  = useLiveQuery(() => db.bonItems.toArray(), []);
  const fileRef   = useRef();
  const [msg, setMsg]         = useState(null);
  const [preview, setPreview] = useState(null); // colonnes détectées avant import

  function notify(text, ok = true) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  function download(rows, filename, sheetName) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  }

  async function exportInventaire() {
    // Format PRESTINFO : Réf, Libellé, Famille, Q. Actuel
    const mvtMap = {};
    movements?.forEach(m => {
      if (!mvtMap[m.productId]) mvtMap[m.productId] = 0;
      if (m.type === 'entree') mvtMap[m.productId] += m.quantity;
      else mvtMap[m.productId] -= m.quantity;
    });
    const rows = products.map(p => ({
      'Réf':       p.reference || '',
      'Libellé':   p.name,
      'Famille':   p.category || '',
      'Q. Actuel': (Number(p.stockInitial || 0) + (mvtMap[p.id] || 0)) || '',
      'Stock min': p.minStock || '',
      'Unité':     p.unit || '',
      'Code-barres': p.barcode || '',
    }));
    download(rows, 'inventaire.xlsx', 'Inventaire');
    notify('Export inventaire réussi');
  }

  async function exportMouvements() {
    const prodMap = {};
    products?.forEach(p => { prodMap[p.id] = p; });
    const rows = movements.map(m => ({
      Date:       m.date?.slice(0, 10),
      Type:       m.type === 'entree' ? 'Entrée' : 'Sortie',
      Libellé:    prodMap[m.productId]?.name || '',
      'Réf':      prodMap[m.productId]?.reference || '',
      Famille:    prodMap[m.productId]?.category || '',
      Quantité:   m.quantity,
      Bon:        m.bonNumber || '',
    }));
    download(rows, 'mouvements.xlsx', 'Mouvements');
    notify('Export mouvements réussi');
  }

  async function exportBons() {
    const prodMap = {};
    products?.forEach(p => { prodMap[p.id] = p; });
    const bonMap = {};
    bons?.forEach(b => { bonMap[b.id] = b; });
    const rows = bonItems.map(item => {
      const bon  = bonMap[item.bonId] || {};
      const prod = prodMap[item.productId] || {};
      return {
        'N° Bon':    bon.number || '',
        Date:        bon.date?.slice(0, 10),
        Destination: bon.destination || '',
        Libellé:     prod.name || '',
        'Réf':       prod.reference || '',
        Famille:     prod.category || '',
        Unité:       prod.unit || '',
        Quantité:    item.quantity,
        Note:        item.note || '',
      };
    });
    download(rows, 'bons_sortie.xlsx', 'Bons');
    notify('Export bons réussi');
  }

  // ── Import ───────────────────────────────────────────────────────────────────
  async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    if (!rows.length) return notify('Fichier vide ou non reconnu', false);

    // Afficher un aperçu des colonnes détectées
    const cols = Object.keys(rows[0]);
    setPreview({ rows, cols, fileName: file.name });
    e.target.value = '';
  }

  async function confirmImport() {
    if (!preview) return;
    const { rows } = preview;
    let count = 0;
    let updated = 0;
    let skipped = 0;

    // Charger les produits existants pour dédupliquer
    const existing = await db.products.toArray();
    const byRef     = {};
    const byBarcode = {};
    existing.forEach(p => {
      if (p.reference) byRef[p.reference.toLowerCase()] = p;
      if (p.barcode)   byBarcode[p.barcode] = p;
    });

    for (const row of rows) {
      const name = String(
        col(row, 'Libellé', 'Désignation', 'Nom', 'name', 'NAME', 'LIBELLE', 'libellé') || ''
      ).trim();
      if (!name) { skipped++; continue; }

      const reference    = String(col(row, 'Réf', 'Référence', 'REF', 'ref', 'reference', 'Code') || '');
      const barcode      = String(col(row, 'Code-barres', 'Barcode', 'EAN', 'barcode') || '');
      const category     = String(col(row, 'Famille', 'Catégorie', 'FAMILLE', 'famille', 'category', 'Categorie') || '');
      const unit         = String(col(row, 'Unité', 'Unite', 'unit', 'UNITE') || 'pièce');
      const stockInitial = Number(col(row, 'Q. Actuel', 'Q.Actuel', 'Stock actuel', 'Quantité', 'stockInitial', 'Stock', 'QTE')) || 0;
      const minStock     = Number(col(row, 'Stock min', 'Stock minimum', 'Min', 'minStock')) || 0;
      const description  = String(col(row, 'Description', 'description', 'Observations', 'Note') || '');

      // Chercher un doublon par référence ou code-barres
      const dupByRef     = reference && byRef[reference.toLowerCase()];
      const dupByBarcode = barcode   && byBarcode[barcode];
      const dup          = dupByRef || dupByBarcode;

      if (dup) {
        // Mettre à jour le produit existant
        await db.products.update(dup.id, { name, reference, barcode, category, unit, stockInitial, minStock, description });
        updated++;
      } else {
        const newProd = { name, reference, barcode, category, unit, stockInitial, minStock, description };
        const newId   = await db.products.add(newProd);
        if (reference) byRef[reference.toLowerCase()] = { ...newProd, id: newId };
        if (barcode)   byBarcode[barcode]              = { ...newProd, id: newId };
        count++;
      }
    }

    setPreview(null);
    const parts = [];
    if (count)   parts.push(`${count} ajouté(s)`);
    if (updated) parts.push(`${updated} mis à jour`);
    if (skipped) parts.push(`${skipped} ignoré(s)`);
    notify(`✓ Import terminé — ${parts.join(', ')}`);
  }

  function downloadTemplate() {
    const template = [
      {
        'Réf': '16°16', 'Libellé': 'GOULOTTE 16x16', 'Famille': 'GOULOTTE',
        'Q. Actuel': 10, 'Stock min': 2, 'Unité': 'mètre linéaire', 'Code-barres': '',
      },
      {
        'Réf': 'IRD 32', 'Libellé': 'TUBE IRD D32', 'Famille': 'TUBE IRD',
        'Q. Actuel': 5, 'Stock min': 1, 'Unité': 'mètre', 'Code-barres': '',
      },
    ];
    download(template, 'modele_import_PRESTINFO.xlsx', 'Inventaire');
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Import / Export Excel</h1>
        <p className="text-sm text-slate-500 mt-0.5">Compatible format PRESTINFO et format personnalisé</p>
      </div>

      {msg && (
        <div
          className="mb-5 flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm font-medium"
          style={msg.ok ? { background: '#d1fae5', color: '#065f46' } : { background: '#fee2e2', color: '#b91c1c' }}
        >
          {msg.ok ? <Check size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}

      {/* Aperçu avant import */}
      {preview && (
        <div className="bg-white rounded-xl border border-indigo-200 shadow-sm p-5 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="font-semibold text-slate-800 text-sm">Aperçu — {preview.fileName}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{preview.rows.length} lignes détectées</p>
            </div>
            <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600 text-xs">Annuler</button>
          </div>

          {/* Colonnes détectées */}
          <div className="mb-3">
            <p className="text-xs text-slate-500 mb-1.5">Colonnes détectées :</p>
            <div className="flex flex-wrap gap-1.5">
              {preview.cols.map(c => (
                <span key={c} className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: '#eef2ff', color: '#4f46e5' }}>
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* Aperçu 3 premières lignes */}
          <div className="overflow-x-auto mb-4 rounded-lg border border-slate-100">
            <table className="text-xs w-full">
              <thead style={{ background: '#0f172a', color: 'white' }}>
                <tr>
                  {preview.cols.slice(0, 6).map(c => (
                    <th key={c} className="px-3 py-2 text-left font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 3).map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                    {preview.cols.slice(0, 6).map(c => (
                      <td key={c} className="px-3 py-2 text-slate-600 truncate max-w-[120px]">{row[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={confirmImport}
            className="w-full py-2.5 rounded-lg text-white text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            style={{ background: '#4f46e5' }}
          >
            <Check size={15} /> Confirmer l'import de {preview.rows.length} produits
          </button>
        </div>
      )}

      {/* Import */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Upload size={14} /> Importer depuis Excel
        </h2>

        {/* Info colonnes acceptées */}
        <div className="rounded-lg p-3 mb-4 text-xs" style={{ background: '#f8fafc' }}>
          <p className="font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
            <Info size={13} /> Colonnes reconnues automatiquement
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-slate-500">
            <span><span className="font-mono text-indigo-600">Libellé</span> ou Nom → Désignation</span>
            <span><span className="font-mono text-indigo-600">Réf</span> ou Référence → Référence</span>
            <span><span className="font-mono text-indigo-600">Famille</span> ou Catégorie → Famille</span>
            <span><span className="font-mono text-indigo-600">Q. Actuel</span> → Stock initial</span>
            <span><span className="font-mono text-indigo-600">Stock min</span> → Stock minimum</span>
            <span><span className="font-mono text-indigo-600">Unité</span> → Unité</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <FileSpreadsheet size={15} /> Modèle PRESTINFO
          </button>
          <button
            onClick={() => fileRef.current.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-white font-medium hover:opacity-90 transition-opacity"
            style={{ background: '#4f46e5' }}
          >
            <Upload size={15} /> Choisir un fichier .xlsx
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileSelect} />
        </div>
      </div>

      {/* Export */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Download size={14} /> Exporter vers Excel
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ExportCard
            title="Inventaire"
            desc={`Format PRESTINFO — ${products?.length || 0} produits`}
            iconBg="#eef2ff" iconColor="#6366f1"
            onClick={exportInventaire}
          />
          <ExportCard
            title="Mouvements"
            desc={`${movements?.length || 0} mouvement(s)`}
            iconBg="#fef3c7" iconColor="#d97706"
            onClick={exportMouvements}
          />
          <ExportCard
            title="Bons de sortie"
            desc={`${bons?.length || 0} bon(s)`}
            iconBg="#d1fae5" iconColor="#059669"
            onClick={exportBons}
          />
        </div>
      </div>
    </div>
  );
}

function ExportCard({ title, desc, iconBg, iconColor, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all text-left"
      style={{ background: '#f8fafc' }}
    >
      <div className="p-2.5 rounded-lg shrink-0" style={{ background: iconBg, color: iconColor }}>
        <FileSpreadsheet size={18} />
      </div>
      <div>
        <div className="font-semibold text-slate-800 text-sm">{title}</div>
        <div className="text-xs text-slate-400 mt-0.5">{desc}</div>
      </div>
    </button>
  );
}
