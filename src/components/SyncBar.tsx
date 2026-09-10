import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { checkServer, pushToServer, pullFromServer } from '../services/sync';
import { Upload, Download, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SyncBar() {
  const queryClient = useQueryClient();

  const { data: online = false, isFetching: checking, refetch } = useQuery({
    queryKey: ['server-status'],
    queryFn: checkServer,
    refetchInterval: 15000,
  });

  const pushMutation = useMutation({
    mutationFn: pushToServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['server-status'] }),
    onSettled: () => { setTimeout(() => pushMutation.reset(), 4000); },
  });

  const pullMutation = useMutation({
    mutationFn: pullFromServer,
    onSettled: () => { setTimeout(() => pullMutation.reset(), 4000); },
  });

  function handlePull() {
    if (!confirm('Remplacer les données locales par celles du serveur ?')) return;
    pullMutation.mutate();
  }

  const busy = pushMutation.isPending || pullMutation.isPending;

  const activeResult = pushMutation.isSuccess || pushMutation.isError
    ? pushMutation
    : pullMutation.isSuccess || pullMutation.isError
      ? pullMutation
      : null;

  const successText = pushMutation.isSuccess
    ? `${pushMutation.data.synced.products} produits · ${pushMutation.data.synced.movements} mouvements · ${pushMutation.data.synced.bons} bons`
    : pullMutation.isSuccess
      ? `${pullMutation.data.products} produits · ${pullMutation.data.movements} mouvements · ${pullMutation.data.bons} bons`
      : '';

  const errorText = pushMutation.error instanceof Error
    ? pushMutation.error.message
    : pullMutation.error instanceof Error
      ? pullMutation.error.message
      : '';

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
        >
          <RefreshCw size={11} className={checking ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Boutons sync */}
      {online && (
        <div className="flex gap-1.5 px-3 pb-3">
          <Button
            onClick={() => pushMutation.mutate()}
            disabled={busy}
            title="Envoyer vers le serveur SQLite"
            size="sm"
            className="flex-1 h-8 text-xs"
          >
            {pushMutation.isPending
              ? <RefreshCw size={11} className="animate-spin" />
              : <Upload size={11} />
            }
            Envoyer
          </Button>
          <Button
            onClick={handlePull}
            disabled={busy}
            title="Recevoir depuis le serveur SQLite"
            size="sm"
            className="flex-1 h-8 text-xs bg-teal-700 hover:bg-teal-700 hover:opacity-90"
          >
            {pullMutation.isPending
              ? <RefreshCw size={11} className="animate-spin" />
              : <Download size={11} />
            }
            Recevoir
          </Button>
        </div>
      )}

      {/* Message résultat */}
      {activeResult && (
        <div
          className="mx-3 mb-3 px-3 py-2 rounded-lg flex items-start gap-2 text-xs"
          style={activeResult.isSuccess
            ? { background: '#064e3b', color: '#6ee7b7' }
            : { background: '#450a0a', color: '#fca5a5' }
          }
        >
          {activeResult.isSuccess
            ? <CheckCircle size={12} className="shrink-0 mt-0.5" />
            : <AlertCircle size={12} className="shrink-0 mt-0.5" />
          }
          <span>{activeResult.isSuccess ? successText : errorText}</span>
        </div>
      )}
    </div>
  );
}
