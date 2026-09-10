import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle,
  GitCompareArrows,
  Play,
  RefreshCw,
  TrendingUp,
  XCircle,
} from 'lucide-react';

interface BacktestResult {
  totalPredictions: number;
  testPeriod: { startDate: string; endDate: string };
  lookbackWindow: number;
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
    random: {
      totalPredictions: number;
      avgMainHits: number;
      fourHitRate: number;
    };
    frequency: {
      totalPredictions: number;
      avgMainHits: number;
      fourHitRate: number;
    };
  };
  comparison: {
    superhybridVsRandom: { avgHitsDiff: number; fourHitRateDiff: number };
    superhybridVsFrequency: { avgHitsDiff: number; fourHitRateDiff: number };
  };
  rollingMetrics: {
    window: number;
    periodStart: string;
    periodEnd: string;
    predictions: number;
    avgHits: number;
    fourHitRate: number;
    boosterHitRate: number;
  }[];
}

interface BacktestRun {
  id: number;
  lookbackWindow: number;
  testPeriod: { startDate: string; endDate: string };
  totalPredictions: number;
  avgMainHits: number;
  fourHitRate: number;
  boosterHitRate: number;
  baselines: {
    random: { avgMainHits: number; fourHitRate: number };
    frequency: { avgMainHits: number; fourHitRate: number };
  };
  completedAt: string | null;
}

function HitDistributionChart({ distribution, total }: { distribution: { hits: number; count: number }[]; total: number }) {
  const maxCount = Math.max(...distribution.map(d => d.count), 1);
  
  return (
    <div className="hit-distribution-chart">
      {distribution.map(({ hits, count }) => (
        <div key={hits} className="bar-container">
          <div className="bar-label">{hits} hits</div>
          <div className="bar-wrapper">
            <div 
              className={`bar ${hits >= 4 ? 'bar-win' : ''}`}
              style={{ height: `${(count / maxCount) * 100}%` }}
            />
          </div>
          <div className="bar-value">
            {count}
            <span className="bar-percent">({total > 0 ? ((count / total) * 100).toFixed(1) : 0}%)</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ComparisonCard({ title, superhybrid, baseline, diff }: { 
  title: string;
  superhybrid: { avgHits: number; fourHitRate: number };
  baseline: { avgHits: number; fourHitRate: number };
  diff: { avgHitsDiff: number; fourHitRateDiff: number };
}) {
  const avgBetter = diff.avgHitsDiff > 0;
  const rateBetter = diff.fourHitRateDiff > 0;
  
  return (
    <div className="comparison-card">
      <h4>{title}</h4>
      <div className="comparison-metrics">
        <div className="metric-row">
          <span className="metric-label">Avg Hits:</span>
          <span className="metric-value">{superhybrid.avgHits.toFixed(3)}</span>
          <span className={`metric-diff ${avgBetter ? 'diff-better' : 'diff-worse'}`}>
            {diff.avgHitsDiff >= 0 ? '+' : ''}{diff.avgHitsDiff.toFixed(3)}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">4-Hit Rate:</span>
          <span className="metric-value">{(superhybrid.fourHitRate * 100).toFixed(2)}%</span>
          <span className={`metric-diff ${rateBetter ? 'diff-better' : 'diff-worse'}`}>
            {diff.fourHitRateDiff >= 0 ? '+' : ''}{(diff.fourHitRateDiff * 100).toFixed(2)}%
          </span>
        </div>
        <div className="metric-row baseline">
          <span className="metric-label">Baseline:</span>
          <span className="metric-value">{(baseline.fourHitRate * 100).toFixed(2)}%</span>
        </div>
      </div>
    </div>
  );
}

export default function BacktestPage() {
  const [lunchBacktest, setLunchBacktest] = useState<BacktestResult | null>(null);
  const [teaBacktest, setTeaBacktest] = useState<BacktestResult | null>(null);
  const [history, setHistory] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'lunchtime' | 'teatime'>('lunchtime');
  const [config, setConfig] = useState({
    lookbackWindow: 90,
    testStartDate: '2024-01-01',
    testEndDate: '2024-06-01',
  });

  useEffect(() => {
    fetchBacktests();
  }, []);

  async function fetchBacktests() {
    try {
      const [lunchRes, teaRes, historyRes] = await Promise.all([
        fetch('/api/backtest/latest/lunchtime'),
        fetch('/api/backtest/latest/teatime'),
        fetch(`/api/backtest/history/${activeTab}`),
      ]);
      
      if (lunchRes.ok) {
        const lunchData = await lunchRes.json();
        setLunchBacktest(lunchData.backtest);
      }
      
      if (teaRes.ok) {
        const teaData = await teaRes.json();
        setTeaBacktest(teaData.backtest);
      }
      
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setHistory(historyData.backtests || []);
      }
    } catch (e) {
      console.error('Failed to fetch backtests:', e);
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest(drawType: 'lunchtime' | 'teatime') {
    setRunning(true);
    setActionError(null);
    try {
      await adminFetch('/api/backtest/run', {
        method: 'POST',
        body: JSON.stringify({ drawType, ...config }),
      });
      await fetchBacktests();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to run backtest');
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <RefreshCw className="spin" size={32} />
        <p>Loading backtest data...</p>
      </div>
    );
  }

  const currentBacktest = activeTab === 'lunchtime' ? lunchBacktest : teaBacktest;

  return (
    <div className="dashboard-backtest">
      <div className="page-intro">
        <div>
          <div className="overline">
            <span className="overline-line" />
            VALIDATION
          </div>
          <h1>Walk-Forward <em>Backtest</em></h1>
          <p>
            Out-of-sample validation of prediction models against historical data.
            All tests use only data available BEFORE each predicted draw.
          </p>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="warning-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>No Future Data Leakage</strong>
          <p>
            Backtests are designed to prevent data leakage. Each prediction is made using only 
            historical data available BEFORE the target draw date. This ensures honest 
            out-of-sample validation.
          </p>
        </div>
      </div>

      {/* Configuration */}
      <section className="section">
        <h2 className="section-title">
          <GitCompareArrows size={20} />
          Backtest Configuration
        </h2>
        
        {actionError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={18} />
            <span>{actionError}</span>
          </div>
        )}
        <div className="panel config-panel">
          <div className="config-grid">
            <div className="config-field">
              <label>Lookback Window</label>
              <select 
                value={config.lookbackWindow}
                onChange={(e) => setConfig({ ...config, lookbackWindow: parseInt(e.target.value) })}
              >
                <option value={30}>30 draws</option>
                <option value={60}>60 draws</option>
                <option value={90}>90 draws</option>
                <option value={180}>180 draws</option>
                <option value={365}>365 draws</option>
              </select>
            </div>
            <div className="config-field">
              <label>Test Start Date</label>
              <input 
                type="date" 
                value={config.testStartDate}
                onChange={(e) => setConfig({ ...config, testStartDate: e.target.value })}
              />
            </div>
            <div className="config-field">
              <label>Test End Date</label>
              <input 
                type="date" 
                value={config.testEndDate}
                onChange={(e) => setConfig({ ...config, testEndDate: e.target.value })}
              />
            </div>
          </div>
          
          <div className="config-actions">
            <button 
              className="btn btn-primary"
              onClick={() => runBacktest('lunchtime')}
              disabled={running}
            >
              <Play size={16} />
              Run Lunchtime Backtest
            </button>
            <button 
              className="btn btn-primary"
              onClick={() => runBacktest('teatime')}
              disabled={running}
            >
              <Play size={16} />
              Run Teatime Backtest
            </button>
          </div>
        </div>
      </section>

      {/* Draw Type Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'lunchtime' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('lunchtime')}
        >
          Lunchtime Results
        </button>
        <button 
          className={`tab ${activeTab === 'teatime' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('teatime')}
        >
          Teatime Results
        </button>
      </div>

      {/* Results */}
      {currentBacktest ? (
        <>
          <section className="section">
            <h2 className="section-title">
              <BarChart3 size={20} />
              SuperHybrid Model Performance
            </h2>
            
            <div className="stat-grid stat-grid-4">
              <div className="stat-tile">
                <div className="stat-accent stat-accent-yellow" />
                <p className="eyebrow">Total Predictions</p>
                <p className="stat-value">{currentBacktest.totalPredictions}</p>
                <p className="stat-hint">Test period: {currentBacktest.testPeriod.startDate} to {currentBacktest.testPeriod.endDate}</p>
              </div>
              <div className="stat-tile">
                <div className="stat-accent stat-accent-green" />
                <p className="eyebrow">Average Hits</p>
                <p className="stat-value">{currentBacktest.superhybrid.avgMainHits.toFixed(3)}</p>
                <p className="stat-hint">Median: {currentBacktest.superhybrid.medianMainHits}</p>
              </div>
              <div className="stat-tile">
                <div className="stat-accent stat-accent-coral" />
                <p className="eyebrow">4-Hit Rate</p>
                <p className="stat-value">{(currentBacktest.superhybrid.fourHitRate * 100).toFixed(2)}%</p>
                <p className="stat-hint">{currentBacktest.superhybrid.fourHitCount} occurrences</p>
              </div>
              <div className="stat-tile">
                <div className="stat-accent stat-accent-blue" />
                <p className="eyebrow">Booster Hit Rate</p>
                <p className="stat-value">{(currentBacktest.superhybrid.boosterHitRate * 100).toFixed(2)}%</p>
                <p className="stat-hint">Lookback: {currentBacktest.lookbackWindow} draws</p>
              </div>
            </div>
          </section>

          {/* Hit Distribution */}
          <section className="section">
            <h2 className="section-title">
              <TrendingUp size={20} />
              Hit Distribution
            </h2>
            
            <div className="panel">
              <HitDistributionChart 
                distribution={currentBacktest.superhybrid.hitDistribution}
                total={currentBacktest.totalPredictions}
              />
            </div>
          </section>

          {/* Baseline Comparisons */}
          <section className="section">
            <h2 className="section-title">
              <GitCompareArrows size={20} />
              Baseline Comparisons
            </h2>
            
            <div className="comparison-grid">
              <ComparisonCard
                title="SuperHybrid vs Random"
                superhybrid={{
                  avgHits: currentBacktest.superhybrid.avgMainHits,
                  fourHitRate: currentBacktest.superhybrid.fourHitRate,
                }}
                baseline={{
                  avgHits: currentBacktest.baselines.random.avgMainHits,
                  fourHitRate: currentBacktest.baselines.random.fourHitRate,
                }}
                diff={currentBacktest.comparison.superhybridVsRandom}
              />
              
              <ComparisonCard
                title="SuperHybrid vs Frequency"
                superhybrid={{
                  avgHits: currentBacktest.superhybrid.avgMainHits,
                  fourHitRate: currentBacktest.superhybrid.fourHitRate,
                }}
                baseline={{
                  avgHits: currentBacktest.baselines.frequency.avgMainHits,
                  fourHitRate: currentBacktest.baselines.frequency.fourHitRate,
                }}
                diff={currentBacktest.comparison.superhybridVsFrequency}
              />
            </div>
          </section>

          {/* Rolling Metrics */}
          {currentBacktest.rollingMetrics.length > 0 && (
            <section className="section">
              <h2 className="section-title">
                <BarChart3 size={20} />
                Rolling Performance
              </h2>
              
              <div className="panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Window</th>
                      <th>Period</th>
                      <th>Predictions</th>
                      <th>Avg Hits</th>
                      <th>4-Hit Rate</th>
                      <th>Booster Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentBacktest.rollingMetrics.map((metric) => (
                      <tr key={metric.window}>
                        <td>{metric.window} draws</td>
                        <td>{metric.periodStart} to {metric.periodEnd}</td>
                        <td>{metric.predictions}</td>
                        <td>{metric.avgHits.toFixed(3)}</td>
                        <td>{(metric.fourHitRate * 100).toFixed(2)}%</td>
                        <td>{(metric.boosterHitRate * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="section">
          <div className="panel empty-state">
            <GitCompareArrows size={48} />
            <h3>No Backtest Results</h3>
            <p>Configure parameters above and run a backtest to see results.</p>
          </div>
        </section>
      )}

      {/* Disclaimer */}
      <div className="disclaimer-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>Understanding Backtest Results</strong>
          <p>
            Backtest results show how the model performed on historical data. 
            High historical performance does NOT guarantee future results. 
            Lottery outcomes are fundamentally random. This is statistical analysis, 
            not prediction of future draws.
          </p>
        </div>
      </div>
    </div>
  );
}
