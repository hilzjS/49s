import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3,
  CalendarDays,
  Clock3,
  Database,
  FileJson,
  FlaskConical,
  GitCompareArrows,
  Globe,
  History,
  Home,
  LayoutDashboard,
  ListFilter,
  Menu,
  Moon,
  Play,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';

type NavItem = {
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge?: string;
};

const navItems: NavItem[] = [
  { path: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { path: '/dashboard/data', label: 'Data', icon: Database },
  { path: '/dashboard/scraper', label: 'Scraper', icon: Globe },
  { path: '/dashboard/lunchtime', label: 'Lunchtime', icon: Sun },
  { path: '/dashboard/teatime', label: 'Teatime', icon: Moon },
  { path: '/dashboard/predictions', label: 'Predictions', icon: Target },
  { path: '/dashboard/backtest', label: 'Backtest', icon: GitCompareArrows },
  { path: '/dashboard/optimizer', label: 'Optimizer', icon: FlaskConical },
  { path: '/dashboard/performance', label: 'Performance', icon: TrendingUp },
  { path: '/dashboard/settings', label: 'Settings', icon: Settings },
];

function Sun({ size = 17, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();
  
  const currentYear = new Date().getFullYear();
  
  return (
    <div className="dashboard-app">
      {/* Mobile scrim */}
      <div 
        className={`mobile-scrim ${sidebarOpen ? 'mobile-scrim-open' : ''}`} 
        onClick={() => setSidebarOpen(false)} 
        aria-hidden="true" 
      />
      
      {/* Sidebar */}
      <aside className={`app-sidebar ${sidebarOpen ? 'app-sidebar-open' : ''}`} aria-label="Primary navigation">
        <div className="brand-lockup">
          <div className="brand-mark"><span>49</span><i /></div>
          <div>
            <p className="brand-name">UK49s</p>
            <p className="brand-subtitle">PREDICTION PLATFORM</p>
          </div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-rule" />
        <p className="sidebar-label">Navigation</p>
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const isActive = location === item.path;
            const Icon = item.icon;
            return (
              <Link key={item.path} href={item.path}>
                <button 
                  className={`sidebar-item ${isActive ? 'sidebar-item-active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {item.badge && <span className="nav-kicker">{item.badge}</span>}
                </button>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-lower">
          <div className="sidebar-status">
            <div className="status-dot status-dot-green" />
            <div>
              <p>Platform Status</p>
              <small>All systems operational</small>
            </div>
          </div>
          <p className="sidebar-version">UK49S PLATFORM v1.0.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span className="breadcrumb-muted">UK49s</span>
            <span>/</span>
            <strong>{navItems.find(i => i.path === location)?.label || 'Dashboard'}</strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-time">
              <Clock3 size={14} /> UTC · {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date())}
            </span>
            <div className="operator-avatar" title="Operator">OP</div>
          </div>
        </header>
        
        <div className="content-wrap">
          {children}
        </div>
        
        <footer className="page-footer">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Statistical predictions based on historical patterns. Lottery outcomes are random.
          </span>
          <span className="footer-right">
            UK49S PREDICTION PLATFORM <span className="footer-separator">·</span> BUILD 1.0.0
          </span>
        </footer>
      </main>
    </div>
  );
}

export default DashboardLayout;
