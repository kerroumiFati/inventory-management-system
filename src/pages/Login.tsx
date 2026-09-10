import { useState, type FormEvent } from 'react';
import { Package, Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE as API } from '../config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erreur de connexion'); return; }
      login(data.token, { username: data.username, role: data.role });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez qu\'il est démarré (npm run server).');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
    >
      <div className="w-full max-w-sm">

        {/* Logo + titre */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: '#4f46e5', boxShadow: '0 8px 32px rgba(79,70,229,0.4)' }}
          >
            <Package size={30} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">GestionStock</h1>
          <p className="text-slate-400 text-sm mt-1">Inventaire & Logistique</p>
        </div>

        {/* Carte login */}
        <Card className="shadow-2xl overflow-hidden rounded-2xl">
          {/* Bandeau top */}
          <div className="h-1" style={{ background: 'linear-gradient(90deg, #4f46e5, #7c3aed)' }} />

          <CardContent className="px-8 py-8">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Connexion</h2>
            <p className="text-sm text-slate-400 mb-6">Accès réservé aux utilisateurs autorisés</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="username" className="block mb-1.5">Identifiant</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  placeholder="admin"
                />
              </div>

              <div>
                <Label htmlFor="password" className="block mb-1.5">Mot de passe</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <span className="font-semibold shrink-0">!</span>
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full py-3 h-auto text-sm font-bold tracking-wide mt-2"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <LogIn size={16} />
                )}
                {loading ? 'Connexion...' : 'Se connecter'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-600 mt-6">
          Application de gestion de stock — mode hors-ligne disponible
        </p>
      </div>
    </div>
  );
}
