import { type ReactNode } from 'react';
import { Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AuthProvider } from '@/lib/auth';
import { AdminShell, UserShell } from '@/components/guards';
import NotFound from '@/pages/not-found';
import Landing from '@/pages/Landing';
import Auth from '@/pages/Auth';
import Home from '@/pages/app/Home';
import Predictions from '@/pages/app/Predictions';
import Results from '@/pages/app/Results';
import Analytics from '@/pages/app/Analytics';
import History from '@/pages/app/History';
import Plans from '@/pages/app/Plans';
import Subscription from '@/pages/app/Subscription';
import AdminOverview from '@/pages/admin/Overview';
import AdminScraper from '@/pages/admin/Scraper';
import AdminModels from '@/pages/admin/Models';
import AdminBacktesting from '@/pages/admin/Backtesting';
import AdminOptimizer from '@/pages/admin/Optimizer';
import AdminUsers from '@/pages/admin/Users';
import AdminPayments from '@/pages/admin/Payments';
import AdminSettings from '@/pages/admin/Settings';

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/auth" component={Auth} />

        <Route path="/app">{() => <UserShell><Home /></UserShell>}</Route>
        <Route path="/app/predictions">{() => <UserShell><Predictions /></UserShell>}</Route>
        <Route path="/app/results">{() => <UserShell><Results /></UserShell>}</Route>
        <Route path="/app/analytics">{() => <UserShell><Analytics /></UserShell>}</Route>
        <Route path="/app/history">{() => <UserShell><History /></UserShell>}</Route>
        <Route path="/app/plans">{() => <UserShell><Plans /></UserShell>}</Route>
        <Route path="/app/subscription">{() => <UserShell><Subscription /></UserShell>}</Route>

        <Route path="/admin">{() => <AdminShell><AdminOverview /></AdminShell>}</Route>
        <Route path="/admin/scraper">{() => <AdminShell><AdminScraper /></AdminShell>}</Route>
        <Route path="/admin/models">{() => <AdminShell><AdminModels /></AdminShell>}</Route>
        <Route path="/admin/backtesting">{() => <AdminShell><AdminBacktesting /></AdminShell>}</Route>
        <Route path="/admin/optimizer">{() => <AdminShell><AdminOptimizer /></AdminShell>}</Route>
        <Route path="/admin/users">{() => <AdminShell><AdminUsers /></AdminShell>}</Route>
        <Route path="/admin/payments">{() => <AdminShell><AdminPayments /></AdminShell>}</Route>
        <Route path="/admin/settings">{() => <AdminShell><AdminSettings /></AdminShell>}</Route>

        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
    </AuthProvider>
  );
}