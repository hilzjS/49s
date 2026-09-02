import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  BarChart3,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';

interface RollingMetric {
  window: number;
  periodStart: string;
  periodEnd: string;
  predictions: number;
  avgHits: number;
  fourHitRate: number;
  boosterHitRate: number;
}

interface BacktestInfo {
  id: number;
  lookbackWindow: number;
  testPeriod: { startDate: string; endDate: string };
  totalPredictions: number;
  superhybrid: {
    hitDistribution: { hits: number; count: number }[];
    avgMainHits: number;
    medianMainHits: number;
    maxMainHits: number;
    fourHitCount: number;
    fourHitRate: number;
    boosterHitRate: number;
  };
  baselines: {
    random: { avgMainHits: number | null; fourHitRate: number | null };
    frequency: { avgMainHits: number | null; fourHitRate: number | null };
  };
  completedAt: string | null;
}

function PerfCard({ title, backtest }: { title: string; backtest: BacktestInfo | null }) {
  if (!backtest) {
    return (
      <div className="panel model-card">
        <h3>{title}</h3>
        <p className="model-empty">No backtest data. Run a backtest first.</p>
      </div>
    );
  }

  const randomRate = backtest.baselines.random.fourHitRate;
  const freqRate = backtest.baselines.frequency.fourHitRate;

  return (
    <div className="panel model-card">
      <div className="model-header">
        <h3>{title}</h3>
        <span className="status-badge status-active">{backtest.totalPredictions} tests</span>
      </div>
      <div className="perf-metrics">
        <div className="perf-row">
          <span>4-Hit Rate</span>
          <strong>{(backtest.superhybrid.fourHitRate * 100).toFixed(2)}%</strong>
        </div>
        <div className="perf-row">
          <span>Avg Main Hits</span>
          <strong>{backtest.superhybrid.avgMainHits.toFixed(3)}</strong>
        </div>
        <div className="perf-row">
          <span>Median Hits</span>
          <strong>{backtest.superhybrid.medianMainHits}</strong>
        </div>
        <div className="perf-row">
          <span>Max Hits</span>
          <strong>{backtest.superhybrid.maxMainHits}</strong>
        </div>
        <div className="perf-row">
          <span>Booster Hit Rate</span>
          <strong>{(backtest.superhybrid.boosterHitRate * 100).toFixed(2)}%</strong>
        </div>
        <div className="perf-row baseline">
          <span>vs Random (4-hit)</span>
          <strong>{randomRate !== null ? `${(randomRate * 100).toFixed(2)}%` : '—'}</strong>
        </div>
        <div className="perf-row baseline">
          <span>vs Frequency (4-hit)</span>
          <strong>{freqRate !== null ? `${(freqRate * 100).toFixed(2)}%` : '—'}</strong>
        </div>
      </div>
      <div className="hit-dist-mini">
        {backtest.superhybrid.hitDistribution.map(({ hits, count }) => (
          <div key={hits} className="dist-chip">
            <span className="dist-label">{hits}</span>
            <span className="dist-count">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const [lunchBacktest, setLunchBacktest] = useState<BacktestInfo | null>(null);
  const [teaBacktest, setTeaBacktest] = useState<BacktestInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [lunchRes, teaRes] = await Promise.all([
          fetch('/api/backtest/latest/lunchtime'),
          fetch('/api/backtest/latest/teatime'),
        ]);
        if (lunchRes.ok) setLunchBacktest((await lunchRes.json()).backtest);
        if (teaRes.ok) setTeaBacktest((await teaRes.json()).backtest);
      } catch (e) {
        console.error('Failed to load performance data:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <RefreshCw className="spin" size={32} />
        <p>Loading performance data...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-performance">
      <div className="page-intro">
        <div>
          <div className="overline"><span className="overline-line" />ANALYTICS</div>
          <h1>Performance <em>Tracking</em></h1>
          <p>
            Out-of-sample performance of SuperHybrid models versus random and
            frequency-only baselines. Lunchtime and Teatime tracked separately.
          </p>
        </div>
      </div>

      <div className="warning-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>Honest Reporting</strong>
          <p>
            These metrics come from walk-forward out-of-sample backtests only.
            If SuperHybrid does not outperform the baselines, that result is shown as-is.
            Lottery draws are random; no model can guarantee outcomes.
          </p>
        </div>
      </div>

      <section className="section">
        <h2 className="section-title"><BarChart3 size={20} />Latest Backtest Performance</h2>
        <div className="predictions-grid">
          <PerfCard title="Lunchtime Model" backtest={lunchBacktest} />
          <PerfCard title="Teatime Model" backtest={teaBacktest} />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title"><TrendingUp size={20} />How to Read These Metrics</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Metric</th><th>Meaning</th><th>What "Good" Looks Like</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="type-cell">4-Hit Rate</td>
                <td>Fraction of predictions where all 4 predicted main numbers appeared in the actual draw (6 main balls drawn)</td>
                <td>Random expectation: ~0.0071% (1 in ~14,125)</td>
              </tr>
              <tr>
                <td className="type-cell">Avg Main Hits</td>
                <td>Average number of the 4 predicted numbers that appeared in the 6 drawn main numbers</td>
                <td>Random expectation: ~0.490 (4 × 6/49)</td>
              </tr>
              <tr>
                <td className="type-cell">Booster Hit Rate</td>
                <td>Fraction of predictions where the predicted booster matched</td>
                <td>Random expectation: ~2.04% (1 in 49)</td>
              </tr>
              <tr>
                <td className="type-cell">Baseline Comparison</td>
                <td>SuperHybrid vs random/frequency-only selection on identical test periods</td>
                <td>SuperHybrid should consistently match or beat baselines to claim any edge</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
