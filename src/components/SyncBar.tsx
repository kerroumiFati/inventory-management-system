import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { checkServer, syncClient, SyncError, type SyncResult } from '../services/sync';
import { useAuth } from '../contexts/useAuth';
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const AUTO_SYNC_INTERVAL_MS = 60_000;
// Délai après une modification locale avant l'envoi automatique (regroupe les saisies rapprochées).
const AUTO_SYNC_DEBOUNCE_MS = 3_000;

function resultNotices(r: SyncResult): string[] {
  const notes: string[] = [];
  if (r.overridden) notes.push(`${r.overridden} modification(s) de ce poste remplacée(s) par une version plus récente venant d'un autre poste.`);
  if (r.orphans) notes.push(`${r.orphans} ligne(s) reçue(s) ignorée(s) : produit ou bon absent de ce poste.`);
  return notes;
}

export default function SyncBar() {
  const { logout } = useAuth();
  const [notices, setNotices] = useState<string[]>([]);

  const { data: online = false, isFetching: checking, refetch } = useQuery({
    queryKey: ['server-status'],
    queryFn: checkServer,
    refetchInterval: 15000,
  });

  // Recalculé à chaque écriture locale (useLiveQuery observe les tables lues).
  const pending = useLiveQuery(() => syncClient.pendingCount(), [], 0);

  const syncMutation = useMutation({
    mutationFn: () => syncClient.sync(),
    onSuccess: r => setNotices(resultNotices(r)),
  });

  const error = syncMutation.error;
  const errorKind = error instanceof SyncError ? error.kind : 'other';
  // Après une session expirée, on n'insiste pas : l'utilisateur doit se reconnecter.
  const authBlocked = syncMutation.isError && errorKind === 'auth';

  // Lancement conditionnel, tenu à jour à chaque rendu pour que les minuteries
  // lisent l'état courant sans être relancées.
  const { mutate, isPending } = syncMutation;
  const trySync = useRef(() => {});
  useEffect(() => {
    trySync.current = () => {
      if (online && !authBlocked && !isPending) mutate();
    };
  });

  // Synchro au démarrage / retour de connexion, puis périodique.
  useEffect(() => {
    if (online) trySync.current();
  }, [online]);
  useEffect(() => {
    const timer = setInterval(() => trySync.current(), AUTO_SYNC_INTERVAL_MS);
    const onOnline = () => { refetch(); };
    window.addEventListener('online', onOnline);
    return () => { clearInterval(timer); window.removeEventListener('online', onOnline); };
  }, [refetch]);

  // Envoi peu après chaque modification locale.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => trySync.current(), AUTO_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const lastSync = syncClient.lastSyncDate();
  const showError = syncMutation.isError && errorKind !== 'network';

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
          onClick={() => refetch()}
          disabled={checking}
          className="text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-40"
          title="Vérifier la connexion"
          aria-label="Vérifier la connexion"
        >
          <RefreshCw size={11} className={checking ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* État des données locales */}
      <div className="px-3.5 pb-2 text-[11px]" style={{ color: pending ? '#fcd34d' : '#64748b' }}>
        {syncMutation.isPending
          ? 'Synchronisation…'
          : pending
            ? `● ${pending} modification(s) en attente d'envoi`
            : lastSync
              ? `À jour — ${lastSync.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
              : 'Jamais synchronisé'}
      </div>

      {online && (
        <div className="px-3 pb-3">
          <Button
            onClick={() => { syncMutation.reset(); syncMutation.mutate(); }}
            disabled={syncMutation.isPending}
            title="Envoyer les modifications de ce poste et recevoir celles des autres"
            size="sm"
            className="w-full h-8 text-xs"
          >
            <RefreshCw size={11} className={syncMutation.isPending ? 'animate-spin' : ''} />
            Synchroniser
          </Button>
        </div>
      )}

      {showError && (
        <div className="mx-3 mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: '#450a0a', color: '#fca5a5' }}>
          <div className="flex items-start gap-2">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{error?.message}</span>
          </div>
          {errorKind === 'auth' && (
            <button onClick={logout} className="mt-2 underline hover:text-white">
              Se reconnecter
            </button>
          )}
        </div>
      )}

      {!showError && notices.length > 0 && (
        <div className="mx-3 mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: '#422006', color: '#fcd34d' }}>
          <div className="flex items-start gap-2">
            <CheckCircle size={12} className="shrink-0 mt-0.5" />
            <div className="space-y-1">{notices.map(n => <p key={n}>{n}</p>)}</div>
          </div>
          <button onClick={() => setNotices([])} className="mt-2 underline hover:text-white">OK</button>
        </div>
      )}
    </div>
  );
}
