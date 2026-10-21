import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import Dashboard   from './pages/Dashboard';
import Products    from './pages/Products';
import NewMovement from './pages/NewMovement';
import Bons        from './pages/Bons';
import BonDetail   from './pages/BonDetail';
import Stock       from './pages/Stock';
import Login       from './pages/Login';
// Chargée à la demande : embarque la bibliothèque xlsx (volumineuse).
const ImportExport = lazy(() => import('./pages/ImportExport'));
const Users        = lazy(() => import('./pages/Users'));
const Reports      = lazy(() => import('./pages/Reports'));
import Inventory   from './pages/Inventory';
import Reorder     from './pages/Reorder';
import SyncBar     from './components/SyncBar';
import AccountDialog from './components/AccountDialog';
import { useAuth } from './contexts/useAuth';
import type { NavigateFn, PageKey } from './types';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  LayoutDashboard, Package, ArrowDownCircle, FileText,
  FileSpreadsheet, Menu, BarChart2, LogOut, User, ChevronRight, ArrowUpCircle, Users as UsersIcon,
  ClipboardCheck, ShoppingCart, PieChart,
} from 'lucide-react';

interface NavItem {
  key: PageKey;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

interface NavSection {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
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
      { key: 'entree',   label: 'Entrée de stock',  icon: ArrowUpCircle },
      { key: 'inventaire', label: 'Inventaire',     icon: ClipboardCheck },
      { key: 'bons',     label: 'Bons',             icon: FileText },
    ],
  },
  {
    label: 'Achats',
    items: [{ key: 'reappro', label: 'Réapprovisionnement', icon: ShoppingCart }],
  },
  {
    label: 'Données',
    items: [
      { key: 'rapports', label: 'Rapports',        icon: PieChart },
      { key: 'import',   label: 'Import / Export', icon: FileSpreadsheet },
    ],
  },
  {
    label: 'Administration',
    adminOnly: true,
    items: [{ key: 'users', label: 'Utilisateurs', icon: UsersIcon }],
  },
];

const PAGE_TITLES: Record<PageKey, string> = {
  dashboard:   'Tableau de bord',
  stock:       'Niveaux de stock',
  products:    'Produits',
  movement:    'Sortie de stock',
  entree:      'Entrée de stock',
  commande:    'Bon de commande',
  reappro:     'Réapprovisionnement',
  inventaire:  'Inventaire',
  rapports:    'Rapports',
  bons:        'Bons',
  'bon-detail': 'Détail du bon',
  import:      'Import / Export Excel',
  users:       'Utilisateurs',
};

// Routage par hash (#/stock, #/bon-detail/12) : F5, bouton retour et favoris fonctionnent.
interface Route { page: PageKey; bonId: number | null }

function parseHash(hash: string): Route {
  const [key, id] = hash.replace(/^#\/?/, '').split('/');
  if (key && key in PAGE_TITLES) {
    const bonId = Number(id);
    return { page: key as PageKey, bonId: Number.isInteger(bonId) && bonId > 0 ? bonId : null };
  }
  return { page: 'dashboard', bonId: null };
}

interface SidebarContentProps {
  page: PageKey;
  navigate: NavigateFn;
  username: string | undefined;
  isAdmin: boolean;
  onLogout: () => void;
  onAccount: () => void;
}

function SidebarContent({ page, navigate, username, isAdmin, onLogout, onAccount }: SidebarContentProps) {
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
        {SECTIONS.filter(s => !s.adminOnly || isAdmin).map(section => (
          <div key={section.label} className="mb-3">
            <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#334155' }}>
              {section.label}
            </p>
            {section.items.map(({ key, label, icon: Icon }) => {
              const active = page === key || (key === 'bons' && page === 'bon-detail') || (key === 'reappro' && page === 'commande');
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
          <button
            onClick={onAccount}
            className="text-sm text-slate-300 truncate flex-1 text-left hover:text-white transition-colors"
            title="Mon compte (mot de passe)"
          >
            {username}
          </button>
          <button
            onClick={onLogout}
            title="Déconnexion"
            aria-label="Déconnexion"
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
  const [route,    setRoute]    = useState<Route>(() => parseHash(window.location.hash));
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { page, bonId } = route;
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${PAGE_TITLES[page]} — GestionStock`;
  }, [page]);

  if (!isAuthenticated) return <Login />;

  const navigate: NavigateFn = (key, extra) => {
    const hash = key === 'bon-detail' && extra?.bonId ? `#/${key}/${extra.bonId}` : `#/${key}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setMenuOpen(false);
  };

  const sidebarProps: SidebarContentProps = {
    page, navigate, username: user?.username, isAdmin, onLogout: logout,
    onAccount: () => { setMenuOpen(false); setAccountOpen(true); },
  };

  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="min-h-screen flex" style={{ background: '#f1f5f9' }}>

      {/* Sidebar desktop (toujours visible) */}
      <aside className="hidden md:flex md:sticky top-0 h-screen flex-col w-60 shrink-0 no-print" style={{ background: '#0f172a' }}>
        <SidebarContent {...sidebarProps} />
      </aside>

      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} username={user?.username} />

      {/* Sidebar mobile (Sheet) */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="p-0 w-60 border-none no-print" style={{ background: '#0f172a' }}>
          <SidebarContent {...sidebarProps} />
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
          <button onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu" className="p-1 rounded text-slate-400 hover:text-white transition-colors">
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
            {page !== 'movement' && page !== 'entree' && page !== 'commande' && page !== 'inventaire' && (
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
          {page === 'products'    && <Products navigate={navigate} />}
          {page === 'movement'    && <NewMovement key="sortie" kind="sortie" navigate={navigate} />}
          {page === 'entree'      && <NewMovement key="entree" kind="entree" navigate={navigate} />}
          {page === 'commande'    && <NewMovement key="commande" kind="commande" navigate={navigate} />}
          {page === 'inventaire'  && <Inventory navigate={navigate} />}
          {page === 'reappro'     && <Reorder navigate={navigate} />}
          {page === 'bons'        && <Bons navigate={navigate} />}
          {page === 'bon-detail'  && <BonDetail bonId={bonId} navigate={navigate} />}
          {(page === 'import' || page === 'users' || page === 'rapports') && (
            <Suspense fallback={<div className="p-8 text-center text-slate-400 text-sm">Chargement...</div>}>
              {page === 'import' && <ImportExport />}
              {page === 'rapports' && <Reports navigate={navigate} />}
              {page === 'users' && (isAdmin
                ? <Users />
                : <div className="p-8 text-center text-slate-400 text-sm">Page réservée aux administrateurs.</div>)}
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
