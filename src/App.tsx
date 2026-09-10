import { useState, type ComponentType } from 'react';
import Dashboard   from './pages/Dashboard';
import Products    from './pages/Products';
import NewMovement from './pages/NewMovement';
import Bons        from './pages/Bons';
import BonDetail   from './pages/BonDetail';
import ImportExport from './pages/ImportExport';
import Stock       from './pages/Stock';
import Login       from './pages/Login';
import SyncBar     from './components/SyncBar';
import { useAuth } from './contexts/AuthContext';
import type { NavigateFn, PageKey } from './types';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  LayoutDashboard, Package, ArrowDownCircle, FileText,
  FileSpreadsheet, Menu, BarChart2, LogOut, User, ChevronRight,
} from 'lucide-react';

interface NavItem {
  key: PageKey;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: 'Aperçu',
    items: [{ key: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard }],
  },
  {
    label: 'Inventaire',
    items: [
      { key: 'stock',    label: 'Niveaux de stock', icon: BarChart2 },
      { key: 'products', label: 'Produits',          icon: Package },
    ],
  },
  {
    label: 'Opérations',
    items: [
      { key: 'movement', label: 'Sortie de stock',  icon: ArrowDownCircle },
      { key: 'bons',     label: 'Bons de sortie',   icon: FileText },
    ],
  },
  {
    label: 'Données',
    items: [{ key: 'import', label: 'Import / Export', icon: FileSpreadsheet }],
  },
];

const PAGE_TITLES: Record<PageKey, string> = {
  dashboard:   'Tableau de bord',
  stock:       'Niveaux de stock',
  products:    'Produits',
  movement:    'Sortie de stock',
  bons:        'Bons de sortie',
  'bon-detail': 'Détail du bon',
  import:      'Import / Export Excel',
};

interface SidebarContentProps {
  page: PageKey;
  navigate: NavigateFn;
  username: string | undefined;
  onLogout: () => void;
}

function SidebarContent({ page, navigate, username, onLogout }: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#4f46e5' }}>
          <Package size={17} className="text-white" />
        </div>
        <div>
          <div className="font-bold text-white text-sm tracking-wide">GestionStock</div>
          <div className="text-xs" style={{ color: '#475569' }}>Inventaire & Logistique</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {SECTIONS.map(section => (
          <div key={section.label} className="mb-3">
            <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#334155' }}>
              {section.label}
            </p>
            {section.items.map(({ key, label, icon: Icon }) => {
              const active = page === key || (key === 'bons' && page === 'bon-detail');
              return (
                <button
                  key={key}
                  onClick={() => navigate(key)}
                  className="relative w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors"
                  style={active
                    ? { background: 'rgba(79,70,229,0.15)', color: '#a5b4fc' }
                    : { color: '#64748b' }
                  }
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r"
                      style={{ background: '#6366f1' }}
                    />
                  )}
                  <Icon size={15} />
                  <span className={active ? 'font-semibold' : 'font-medium'}>{label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-1" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: '#1e293b' }}>
            <User size={12} className="text-slate-400" />
          </div>
          <span className="text-sm text-slate-300 truncate flex-1">{username}</span>
          <button
            onClick={onLogout}
            title="Déconnexion"
            className="text-slate-500 hover:text-red-400 transition-colors"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Sync */}
      <SyncBar />
    </div>
  );
}

export default function App() {
  const { isAuthenticated, user, logout } = useAuth();
  const [page,     setPage]     = useState<PageKey>('dashboard');
  const [bonId,    setBonId]    = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  if (!isAuthenticated) return <Login />;

  const navigate: NavigateFn = (key, extra) => {
    setPage(key);
    if (extra?.bonId) setBonId(extra.bonId);
    setMenuOpen(false);
  };

  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="min-h-screen flex" style={{ background: '#f1f5f9' }}>

      {/* Sidebar desktop (toujours visible) */}
      <aside className="hidden md:flex md:sticky top-0 h-screen flex-col w-60 shrink-0 no-print" style={{ background: '#0f172a' }}>
        <SidebarContent page={page} navigate={navigate} username={user?.username} onLogout={logout} />
      </aside>

      {/* Sidebar mobile (Sheet) */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="p-0 w-60 border-none no-print" style={{ background: '#0f172a' }}>
          <SidebarContent page={page} navigate={navigate} username={user?.username} onLogout={logout} />
        </SheetContent>
      </Sheet>

      {/* ─── Contenu principal ───────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header mobile */}
        <div
          className="md:hidden flex items-center justify-between px-4 py-3 no-print"
          style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#4f46e5' }}>
              <Package size={13} className="text-white" />
            </div>
            <span className="font-semibold text-white text-sm">GestionStock</span>
          </div>
          <button onClick={() => setMenuOpen(true)} className="p-1 rounded text-slate-400 hover:text-white transition-colors">
            <Menu size={20} />
          </button>
        </div>

        {/* Barre de contexte desktop */}
        <div
          className="hidden md:flex items-center justify-between px-7 py-3 no-print"
          style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}
        >
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>GestionStock</span>
            <ChevronRight size={12} className="text-slate-300" />
            <span className="text-slate-600 font-medium">{PAGE_TITLES[page] ?? ''}</span>
          </div>
          <div className="flex items-center gap-5">
            <span className="text-xs text-slate-400 capitalize">{today}</span>
            {page !== 'movement' && (
              <Button size="sm" className="text-xs" onClick={() => navigate('movement')}>
                <ArrowDownCircle size={13} /> Nouvelle sortie
              </Button>
            )}
          </div>
        </div>

        {/* Page */}
        <main className="flex-1 p-4 md:p-7">
          {page === 'dashboard'   && <Dashboard navigate={navigate} />}
          {page === 'stock'       && <Stock navigate={navigate} />}
          {page === 'products'    && <Products />}
          {page === 'movement'    && <NewMovement navigate={navigate} />}
          {page === 'bons'        && <Bons navigate={navigate} />}
          {page === 'bon-detail'  && <BonDetail bonId={bonId} navigate={navigate} />}
          {page === 'import'      && <ImportExport />}
        </main>
      </div>
    </div>
  );
}
