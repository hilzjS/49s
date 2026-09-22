import { useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3,
  Boxes,
  CreditCard,
  FlaskConical,
  GitCompareArrows,
  History,
  Home,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Sparkles,
  Target,
  Users,
  Download,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui';

type NavItem = {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

const userNav: NavItem[] = [
  { path: '/app', label: 'Home', icon: Home },
  { path: '/app/predictions', label: 'Predictions', icon: Target },
  { path: '/app/results', label: 'Results', icon: ListChecks },
  { path: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/app/history', label: 'History', icon: History },
  { path: '/app/plans', label: 'Plans', icon: CreditCard },
];

const adminNav: NavItem[] = [
  { path: '/admin', label: 'Overview', icon: LayoutDashboard },
  { path: '/admin/scraper', label: 'Scraper', icon: Download },
  { path: '/admin/models', label: 'Models', icon: Boxes },
  { path: '/admin/backtesting', label: 'Backtesting', icon: GitCompareArrows },
  { path: '/admin/optimizer', label: 'Optimizer', icon: FlaskConical },
  { path: '/admin/users', label: 'Users', icon: Users },
  { path: '/admin/payments', label: 'Payments', icon: Receipt },
  { path: '/admin/settings', label: 'Settings', icon: Settings },
];

const mobileNav: NavItem[] = [
  { path: '/app', label: 'Home', icon: Home },
  { path: '/app/predictions', label: 'Predict', icon: Target },
  { path: '/app/results', label: 'Results', icon: ListChecks },
  { path: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/app/plans', label: 'Plans', icon: CreditCard },
];

function isActive(location: string, path: string): boolean {
  if (path === '/app') return location === '/app';
  if (path === '/admin') return location === '/admin';
  return location === path || location.startsWith(`${path}/`);
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const [location] = useLocation();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`nav-link ${isActive(location, item.path) ? 'active' : ''}`}
            onClick={onNavigate}
          >
            <Icon size={17} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({
  onNavigate,
  extra,
}: {
  onNavigate?: () => void;
  extra?: ReactNode;
}) {
  const { profile, isAdmin } = useAuth();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/" className="flex items-center gap-2.5 px-2 py-1" onClick={onNavigate}>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--gold)] text-[15px] font-bold text-[#17130a]">
          49
        </span>
        <span className="leading-tight">
          <span className="display block text-[15px] font-semibold text-[var(--text)]">49S Predictor</span>
          <span className="block text-[10.5px] uppercase tracking-[0.16em] text-[var(--text-3)]">
            Statistical
          </span>
        </span>
      </Link>

      <div className="flex-1 overflow-y-auto">
        <p className="eyebrow px-3 pb-2">Workspace</p>
        <NavList items={userNav} onNavigate={onNavigate} />

        {isAdmin ? (
          <>
            <p className="eyebrow px-3 pb-2 pt-6">Administration</p>
            <NavList items={adminNav} onNavigate={onNavigate} />
          </>
        ) : null}
      </div>

      {extra}
      {profile ? (
        <div className="card-2 flex items-center gap-2.5 px-3 py-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--surface-3)] text-[12px] font-semibold text-[var(--gold)]">
            {(profile.full_name || profile.email || 'U').slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-[var(--text)]">
              {profile.full_name || 'Account'}
            </span>
            <span className="block truncate text-[11px] text-[var(--text-3)]">{profile.email}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [location] = useLocation();
  const { profile, isAdmin, signOut } = useAuth();

  const currentLabel = [...userNav, ...adminNav].find((item) => isActive(location, item.path))?.label ?? 'App';

  return (
    <div className="min-h-screen bg-[var(--ink)]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] border-r border-[var(--line)] bg-[var(--ink-2)] lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-[268px] border-r border-[var(--line)] bg-[var(--ink-2)]">
            <button
              className="absolute right-3 top-3 rounded-lg p-1.5 text-[var(--text-3)] hover:text-[var(--text)]"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:pl-[252px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[var(--line)] bg-[var(--ink)]/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            className="rounded-lg border border-[var(--line)] p-2 text-[var(--text-2)] lg:hidden"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>

          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-3)]">49S Predictor</p>
            <p className="truncate text-[14px] font-semibold text-[var(--text)]">{currentLabel}</p>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <Badge tone={profile?.plan_id === 'vip' ? 'violet' : profile?.plan_id === 'pro' ? 'sky' : 'neutral'}>
              <Sparkles size={12} />
              {(profile?.plan_id ?? 'free').toUpperCase()}
            </Badge>

            <div className="relative">
              <button
                className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line-2)] bg-[var(--surface-2)] text-[12px] font-semibold text-[var(--text)]"
                onClick={() => setMenu((v) => !v)}
                aria-label="Account menu"
              >
                {(profile?.full_name || profile?.email || 'U').slice(0, 1).toUpperCase()}
              </button>
              {menu ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} aria-hidden />
                  <div className="card absolute right-0 z-20 mt-2 w-56 p-2 shadow-xl">
                    <div className="px-3 py-2">
                      <p className="truncate text-[12.5px] font-medium text-[var(--text)]">
                        {profile?.full_name || 'Account'}
                      </p>
                      <p className="truncate text-[11px] text-[var(--text-3)]">{profile?.email}</p>
                    </div>
                    <div className="my-1 h-px bg-[var(--line)]" />
                    <Link
                      href="/app/subscription"
                      className="nav-link"
                      onClick={() => setMenu(false)}
                    >
                      <CreditCard size={16} />
                      Subscription
                    </Link>
                    {isAdmin ? (
                      <Link href="/admin/settings" className="nav-link" onClick={() => setMenu(false)}>
                        <Settings size={16} />
                        Settings
                      </Link>
                    ) : null}
                    <button className="nav-link w-full text-left" onClick={() => void signOut()}>
                      <LogOut size={16} />
                      Sign out
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <main className="app-gradient min-h-[calc(100vh-4rem)] px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
          <div className="mx-auto w-full max-w-[1180px]">{children}</div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--ink-2)]/95 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-between px-2 py-1.5">
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(location, item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10.5px] font-medium ${
                  active ? 'text-[var(--gold)]' : 'text-[var(--text-3)]'
                }`}
              >
                <Icon size={19} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}