import { useState, useEffect, useCallback } from 'react';
import { checkServer, pushToServer, pullFromServer } from '../services/sync';
import { Upload, Download, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

type SyncStatus = 'idle' | 'pushing' | 'pulling' | 'ok' | 'error';

export default function SyncBar() {
  const [online,   setOnline]   = useState(false);
  const [status,   setStatus]   = useState<SyncStatus>('idle');
  const [msg,      setMsg]      = useState('');
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    setOnline(await checkServer());
    setChecking(false);
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [check]);

  function notify(text: string, ok: boolean) {
    setMsg(text);
    setStatus(ok ? 'ok' : 'error');
    setTimeout(() => { setMsg(''); setStatus('idle'); }, 4000);
  }

  async function push() {
    setStatus('pushing');
    try {
      const r = await pushToServer();
      notify(`${r.synced.products} produits · ${r.synced.movements} mouvements · ${r.synced.bons} bons`, true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    }
  }

  async function pull() {
    if (!confirm('Remplacer les données locales par celles du serveur ?')) return;
    setStatus('pulling');
    try {
      const r = await pullFromServer();
      notify(`${r.products} produits · ${r.movements} mouvements · ${r.bons} bons`, true);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    }
  }

  const busy = status === 'pushing' || status === 'pulling';

  return (
    <div className="mx-3 mb-3 rounded-xl overflow-hidden" style={{ background: '#1e293b' }}>

      {/* Ligne de statut */}
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {checking
            ? <RefreshCw size={12} className="text-slate-500 animate-spin" />
            : online
              ? <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" style={{ boxShadow: '0 0 0 2px rgba(52,211,153,0.25)' }} />
              : <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
          }
          <span className="text-xs font-medium" style={{ color: online ? '#6ee7b7' : '#64748b' }}>
            {online ? 'Serveur connecté' : 'Mode hors-ligne'}
          </span>
        </div>
        <button
          onClick={check}
          disabled={checking}
          className="text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-40"
          title="Vérifier la connexion"
        >
          <RefreshCw size={11} className={checking ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Boutons sync */}
      {online && (
        <div className="flex gap-1.5 px-3 pb-3">
          <button
            onClick={push}
            disabled={busy}
            title="Envoyer vers le serveur SQLite"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: '#4f46e5', color: 'white' }}
          >
            {status === 'pushing'
              ? <RefreshCw size={11} className="animate-spin" />
              : <Upload size={11} />
            }
            Envoyer
          </button>
          <button
            onClick={pull}
            disabled={busy}
            title="Recevoir depuis le serveur SQLite"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: '#0f766e', color: 'white' }}
          >
            {status === 'pulling'
              ? <RefreshCw size={11} className="animate-spin" />
              : <Download size={11} />
            }
            Recevoir
          </button>
        </div>
      )}

      {/* Message résultat */}
      {msg && (
        <div
          className="mx-3 mb-3 px-3 py-2 rounded-lg flex items-start gap-2 text-xs"
          style={status === 'ok'
            ? { background: '#064e3b', color: '#6ee7b7' }
            : { background: '#450a0a', color: '#fca5a5' }
          }
        >
          {status === 'ok' ? <CheckCircle size={12} className="shrink-0 mt-0.5" /> : <AlertCircle size={12} className="shrink-0 mt-0.5" />}
          <span>{msg}</span>
        </div>
      )}
    </div>
  );
}
