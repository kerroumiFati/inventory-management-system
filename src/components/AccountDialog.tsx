import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { apiFetch } from '../services/api';
import { PASSWORD_MIN_LENGTH } from '../../shared/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string | undefined;
}

// Changement du mot de passe de l'utilisateur connecté.
export default function AccountDialog({ open, onOpenChange, username }: AccountDialogProps) {
  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [confirm, setConfirm] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiFetch('/auth/change-password', {
      method: 'POST', json: { currentPassword: current, newPassword: next },
    }),
    onSuccess: () => { setCurrent(''); setNext(''); setConfirm(''); },
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
  const valid    = current && next.length >= PASSWORD_MIN_LENGTH && next === confirm;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) mutation.mutate();
  }

  function close(o: boolean) {
    if (!o) { mutation.reset(); setCurrent(''); setNext(''); setConfirm(''); }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <div>
              <DialogTitle>Mon compte</DialogTitle>
              <p className="text-xs text-slate-400 mt-0.5">Connecté en tant que {username}</p>
            </div>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <div>
              <Label htmlFor="pwd-current" className="block mb-1.5">Mot de passe actuel</Label>
              <Input id="pwd-current" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pwd-new" className="block mb-1.5">Nouveau mot de passe</Label>
              <Input id="pwd-new" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} />
              <p className={`text-xs mt-1.5 ${tooShort ? 'text-red-600' : 'text-slate-400'}`}>Au moins {PASSWORD_MIN_LENGTH} caractères</p>
            </div>
            <div>
              <Label htmlFor="pwd-confirm" className="block mb-1.5">Confirmer</Label>
              <Input id="pwd-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
              {mismatch && <p className="text-xs mt-1.5 text-red-600">Les deux mots de passe ne correspondent pas</p>}
            </div>
            {mutation.isError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{mutation.error.message}</p>
            )}
            {mutation.isSuccess && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">Mot de passe modifié.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="flex-1" onClick={() => close(false)}>Fermer</Button>
            <Button type="submit" className="flex-1" disabled={!valid || mutation.isPending}>
              <Check size={15} /> Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
