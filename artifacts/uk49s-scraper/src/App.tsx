import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/home';
import DashboardLayout from '@/pages/dashboard/Layout';
import Overview from '@/pages/dashboard/Overview';
import DataPage from '@/pages/dashboard/Data';
import PredictionsPage from '@/pages/dashboard/Predictions';
import BacktestPage from '@/pages/dashboard/Backtest';
import OptimizerPage from '@/pages/dashboard/Optimizer';
import PerformancePage from '@/pages/dashboard/Performance';
import SettingsPage from '@/pages/dashboard/Settings';
import DrawTypePage from '@/pages/dashboard/DrawType';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function LunchtimePage() {
  return <DrawTypePage drawType="lunchtime" title="Lunchtime" subtitle="UK49s Lunchtime (13:00) historical data, model, predictions and performance." />;
}

function TeatimePage() {
  return <DrawTypePage drawType="teatime" title="Teatime" subtitle="UK49s Teatime (18:45) historical data, model, predictions and performance." />;
}

function DashboardRoutes() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/dashboard" component={Overview} />
        <Route path="/dashboard/data" component={DataPage} />
        <Route path="/dashboard/scraper" component={Home} />
        <Route path="/dashboard/lunchtime" component={LunchtimePage} />
        <Route path="/dashboard/teatime" component={TeatimePage} />
        <Route path="/dashboard/predictions" component={PredictionsPage} />
        <Route path="/dashboard/backtest" component={BacktestPage} />
        <Route path="/dashboard/optimizer" component={OptimizerPage} />
        <Route path="/dashboard/performance" component={PerformancePage} />
        <Route path="/dashboard/settings" component={SettingsPage} />
        <Route component={Overview} />
      </Switch>
    </DashboardLayout>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/dashboard" component={DashboardRoutes} />
        <Route path="/dashboard/:path*" component={DashboardRoutes} />
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
