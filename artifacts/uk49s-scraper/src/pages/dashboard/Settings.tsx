import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Globe,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

interface ScraperHealth {
  status: string;
  service: string;
  cacheEntries: number;
  lastScrapeAt: string | null;
}

export default function SettingsPage() {
  const [health, setHealth] = useState<ScraperHealth | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/api/health');
        setApiOk(res.ok);
        const scraperRes = await fetch('/api/health');
        if (scraperRes.ok) setHealth(await scraperRes.json());
      } catch {
        setApiOk(false);
      }
    }
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-settings">
      <div className="page-intro">
        <div>
          <div className="overline"><span className="overline-line" />CONFIGURATION</div>
          <h1>Platform <em>Settings</em></h1>
          <p>System status, data sources, and operational information.</p>
        </div>
      </div>

      <section className="section">
        <h2 className="section-title"><Server size={20} />System Status</h2>
        <div className="stat-grid stat-grid-3">
          <div className="stat-tile">
            <div className={`stat-accent ${apiOk ? 'stat-accent-green' : 'stat-accent-coral'}`} />
            <p className="eyebrow">API Server</p>
            <p className="stat-value">
              {apiOk === null ? 'Checking' : apiOk ? <CheckCircle size={24} color="#69db7c" /> : <XCircle size={24} color="#ff6b6b" />}
            </p>
            <p className="stat-hint">{apiOk ? 'Responding' : 'Unreachable'}</p>
          </div>
          <div className="stat-tile">
            <div className="stat-accent stat-accent-yellow" />
            <p className="eyebrow">Scraper Service</p>
            <p className="stat-value">{health?.status === 'ok' ? 'Ready' : '—'}</p>
            <p className="stat-hint">Cache entries: {health?.cacheEntries ?? 0}</p>
          </div>
          <div className="stat-tile">
            <div className="stat-accent stat-accent-blue" />
            <p className="eyebrow">Last Scrape</p>
            <p className="stat-value" style={{ fontSize: 16 }}>
              {health?.lastScrapeAt ? new Date(health.lastScrapeAt).toLocaleString() : 'Never'}
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title"><Globe size={20} />Data Sources</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Source</th><th>URL Pattern</th><th>Usage</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="type-cell">UK49s Lunchtime</td>
                <td className="url-cell">https://uk.lottonumbers.com/uk49s-lunchtime/results/YEAR</td>
                <td>Primary historical source</td>
              </tr>
              <tr>
                <td className="type-cell">UK49s Teatime</td>
                <td className="url-cell">https://uk.lottonumbers.com/uk49s-teatime/results/YEAR</td>
                <td>Primary historical source</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title"><Settings size={20} />Platform Configuration</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Setting</th><th>Value</th><th>Notes</th></tr>
            </thead>
            <tbody>
              <tr><td className="type-cell">Historical Start Year</td><td>2015</td><td>Scraper covers 2015 through current year</td></tr>
              <tr><td className="type-cell">Number Range</td><td>1–49</td><td>Strictly validated on ingestion</td></tr>
              <tr><td className="type-cell">Prediction Format</td><td>4 main + 1 booster</td><td>Never 5 or 6 main numbers</td></tr>
              <tr><td className="type-cell">Default Lookback</td><td>90 draws</td><td>Configurable per model</td></tr>
              <tr><td className="type-cell">Scrape Throttle</td><td>350 ms</td><td>Minimum gap between source requests</td></tr>
              <tr><td className="type-cell">Cache TTL</td><td>15 minutes</td><td>Reduces load on source site</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title"><ShieldCheck size={20} />Environment Variables</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Variable</th><th>Required</th><th>Purpose</th></tr>
            </thead>
            <tbody>
              <tr><td className="type-cell">DATABASE_URL</td><td>Yes</td><td>PostgreSQL connection string (server-side only)</td></tr>
              <tr><td className="type-cell">PORT</td><td>Yes</td><td>API server port</td></tr>
              <tr><td className="type-cell">ADMIN_API_KEY</td><td>Recommended</td><td>Protects administrative endpoints</td></tr>
            </tbody>
          </table>
          <div className="warning-banner" style={{ marginTop: 16, marginBottom: 0 }}>
            <AlertTriangle size={20} />
            <div>
              <strong>Security Note</strong>
              <p>Secrets are never exposed to frontend code. All credentials are read from server-side environment variables only.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
