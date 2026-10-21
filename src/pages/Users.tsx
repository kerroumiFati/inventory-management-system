import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, KeyRound, Users as UsersIcon, Check, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useAuth } from '../contexts/useAuth';
import { PASSWORD_MIN_LENGTH, ROLES, type Role, type UserInfo } from '../../shared/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const ROLE_LABELS: Record<Role, string> = { admin: 'Administrateur', user: 'Utilisateur' };

type Editing = { mode: 'create' } | { mode: 'password'; user: UserInfo } | null;

export default function Users() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [error,   setError]   = useState('');

  const { data: users, isLoading, error: loadError } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<UserInfo[]>('/users'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; role?: Role; password?: string }) =>
      apiFetch<UserInfo>(`/users/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => { setError(''); refresh(); },
    onError: e => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setError(''); refresh(); },
    onError: e => setError(e.message),
  });

  function confirmDelete(u: UserInfo) {
    if (!confirm(`Supprimer le compte « ${u.username} » ?\n\nLa personne ne pourra plus se connecter. Les données de stock ne sont pas touchées.`)) return;
    remove.mutate(u.id);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Utilisateurs</h1>
          <p className="text-sm text-slate-500 mt-0.5">Comptes autorisés à se connecter</p>
        </div>
        <Button onClick={() => setEditing({ mode: 'create' })}>
          <Plus size={16} /> Nouvel utilisateur
        </Button>
      </div>

      {(error || loadError) && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error || loadError?.message}
        </div>
      )}

      <Card className="overflow-hidden">
        {isLoading && <div className="p-8 text-center text-sm text-slate-400">Chargement...</div>}
        {users?.length === 0 && (
          <div className="p-10 text-center">
            <UsersIcon size={36} className="mx-auto mb-3 text-slate-200" />
            <p className="text-sm text-slate-400">Aucun utilisateur</p>
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {users?.map(u => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-[140px]">
                <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                  {u.role === 'admin' && <ShieldCheck size={14} className="text-indigo-500" />}
                  {u.username}
                  {u.username === me?.username && <span className="text-xs font-normal text-slate-400">(vous)</span>}
                </div>
                <div className="text-xs text-slate-400">
                  Créé le {new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR')}
                </div>
              </div>
              <Select value={u.role} onValueChange={role => update.mutate({ id: u.id, role: role as Role })}>
                <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setEditing({ mode: 'password', user: u })}>
                <KeyRound size={13} /> Mot de passe
              </Button>
              <button
                onClick={() => confirmDelete(u)}
                disabled={u.username === me?.username}
                title={u.username === me?.username ? 'Vous ne pouvez pas supprimer votre propre compte' : 'Supprimer'}
                aria-label={`Supprimer ${u.username}`}
                className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-slate-400 mt-3">
        Les administrateurs gèrent les comptes ; les utilisateurs ont accès à toutes les fonctions de stock.
      </p>

      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-sm">
          {editing && (
            <UserForm
              editing={editing}
              onDone={() => { setEditing(null); refresh(); }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface UserFormProps {
  editing: NonNullable<Editing>;
  onDone: () => void;
  onCancel: () => void;
}

function UserForm({ editing, onDone, onCancel }: UserFormProps) {
  const creating = editing.mode === 'create';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role,     setRole]     = useState<Role>('user');

  const mutation = useMutation({
    mutationFn: () => creating
      ? apiFetch('/users', { method: 'POST', json: { username: username.trim(), password, role } })
      : apiFetch(`/users/${editing.user.id}`, { method: 'PATCH', json: { password } }),
    onSuccess: onDone,
  });

  const valid = password.length >= PASSWORD_MIN_LENGTH && (!creating || username.trim().length >= 2);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) mutation.mutate();
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{creating ? 'Nouvel utilisateur' : `Mot de passe de ${editing.user.username}`}</DialogTitle>
      </DialogHeader>
      <div className="px-6 py-5 space-y-4">
        {creating && (
          <div>
            <Label htmlFor="new-username" className="block mb-1.5">Identifiant</Label>
            <Input id="new-username" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
          </div>
        )}
        <div>
          <Label htmlFor="new-password" className="block mb-1.5">{creating ? 'Mot de passe' : 'Nouveau mot de passe'}</Label>
          <Input id="new-password" type="text" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} autoFocus={!creating} />
          <p className="text-xs mt-1.5 text-slate-400">Au moins {PASSWORD_MIN_LENGTH} caractères. Communiquez-le à la personne concernée.</p>
        </div>
        {creating && (
          <div>
            <Label className="block mb-1.5">Rôle</Label>
            <Select value={role} onValueChange={r => setRole(r as Role)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {mutation.isError && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{mutation.error.message}</p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Annuler</Button>
        <Button type="submit" className="flex-1" disabled={!valid || mutation.isPending}>
          <Check size={15} /> Enregistrer
        </Button>
      </DialogFooter>
    </form>
  );
}
