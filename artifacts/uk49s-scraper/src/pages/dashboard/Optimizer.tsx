import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  FlaskConical,
  Play,
  RefreshCw,
  Settings2,
  TrendingUp,
  History,
} from 'lucide-react';

interface OptimizerRunInfo {
  id: number;
  status: string;
  configsTested: number;
  validationPeriod: { startDate: string; endDate: string };
  testPeriod: { startDate: string; endDate: string } | null;
  bestMetrics: { fourHitRate: number | null; avgHits: number | null };
  completedAt: string | null;
}

interface ModelInfo {
  id: number;
  version: string;
  lookbackWindow: number;
  weights: Record<string, number>;
  constraints: { enforceDiversity: boolean; minNumberSpread: number; maxSameGroup: number };
  validationMetrics: { fourHitRate: number; avgHits: number; sampleSize: number } | null;
}

const weightLabels: Record<string, string> = {
  weightFrequency: 'Frequency',
  weightRecency: 'Recency',
  weightHotCold: 'Hot/Cold',
  weightGapAnalysis: 'Gap Analysis',
  weightPairs: 'Pairs',
  weightTriples: 'Triples',
  weightConsecutive: 'Consecutive',
  weightOddEven: 'Odd/Even',
  weightLowHigh: 'Low/High',
  weightSumRange: 'Sum/Range',
  weightPositional: 'Positional',
  weightRepeat: 'Repeat',
  weightFirst3Minus2: 'First3Minus2',
};

export default function OptimizerPage() {
  const [activeTab, setActiveTab] = useState<'lunchtime' | 'teatime'>('lunchtime');
  const [models, setModels] = useState<{ lunch: ModelInfo | null; tea: ModelInfo | null }>({ lunch: null, tea: null });
  const [history, setHistory] = useState<OptimizerRunInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState({
    validationStartDate: '2023-01-01',
    validationEndDate: '2023-12-31',
    testStartDate: '2024-01-01',
    testEndDate: '2024-06-01',
    populationSize: 50,
    eliteSize: 5,
    mutationRate: 0.2,
    minValidationSamples: 50,
    applyToModel: false,
  });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  async function fetchData() {
    try {
      const [lunchRes, teaRes, histRes] = await Promise.all([
        fetch('/api/predictions/model/lunchtime'),
        fetch('/api/predictions/model/teatime'),
        fetch(`/api/optimizer/history/${activeTab}`),
      ]);
      if (lunchRes.ok) {
        const data = await lunchRes.json();
        setModels(m => ({ ...m, lunch: data.model }));
      }
      if (teaRes.ok) {
        const data = await teaRes.json();
        setModels(m => ({ ...m, tea: data.model }));
      }
      if (histRes.ok) {
        const data = await histRes.json();
        setHistory(data.optimizationRuns || []);
      }
    } catch (e) {
      console.error('Failed to load optimizer data:', e);
    }
  }

  async function runOptimization() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/optimizer/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drawType: activeTab, ...config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Optimization failed');
      setResult(data);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimization failed');
    } finally {
      setRunning(false);
    }
  }

  const currentModel = activeTab === 'lunchtime' ? models.lunch : models.tea;

  return (
    <div className="dashboard-optimizer">
      <div className="page-intro">
        <div>
          <div className="overline"><span className="overline-line" />OPTIMIZER</div>
          <h1>Model <em>Optimization</em></h1>
          <p>
            Random Search + Hill Climbing optimization of SuperHybrid feature weights,
            lookback windows, and diversity constraints. Validated out-of-sample.
          </p>
        </div>
      </div>

      <div className="warning-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>Overfitting Safeguards</strong>
          <p>
            Configurations are only selected if they have sufficient validation samples.
            Optimization runs on a validation period; the selected configuration is then
            evaluated on a separate test period it was NOT optimized against.
          </p>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'lunchtime' ? 'tab-active' : ''}`} onClick={() => setActiveTab('lunchtime')}>
          Lunchtime Optimizer
        </button>
        <button className={`tab ${activeTab === 'teatime' ? 'tab-active' : ''}`} onClick={() => setActiveTab('teatime')}>
          Teatime Optimizer
        </button>
      </div>

      {/* Current Model */}
      <section className="section">
        <h2 className="section-title"><Settings2 size={20} />Current Configuration - {activeTab}</h2>
        <div className="panel">
          {currentModel ? (
            <>
              <div className="model-header">
                <h3>Version: {currentModel.version}</h3>
                <span className="status-badge status-active">Active</span>
              </div>
              <div className="weights-grid">
                {Object.entries(currentModel.weights).map(([key, value]) => (
                  <div key={key} className="weight-item">
                    <span className="weight-label">{weightLabels[key] || key}</span>
                    <span className="weight-value">{value.toFixed(1)}</span>
                  </div>
                ))}
                <div className="weight-item">
                  <span className="weight-label">Lookback Window</span>
                  <span className="weight-value">{currentModel.lookbackWindow}</span>
                </div>
                <div className="weight-item">
                  <span className="weight-label">Diversity</span>
                  <span className="weight-value">{currentModel.constraints.enforceDiversity ? 'On' : 'Off'}</span>
                </div>
              </div>
              {currentModel.validationMetrics && (
                <div className="model-metrics-row">
                  <span>Validation 4-Hit Rate: <strong>{(currentModel.validationMetrics.fourHitRate * 100).toFixed(2)}%</strong></span>
                  <span>Avg Hits: <strong>{currentModel.validationMetrics.avgHits.toFixed(3)}</strong></span>
                  <span>Samples: <strong>{currentModel.validationMetrics.sampleSize}</strong></span>
                </div>
              )}
            </>
          ) : (
            <p className="model-empty">No model configured yet. Run optimization to create one.</p>
          )}
        </div>
      </section>

      {/* Run Optimization */}
      <section className="section">
        <h2 className="section-title"><FlaskConical size={20} />Run Optimization</h2>
        <div className="panel config-panel">
          <div className="config-grid">
            <div className="config-field">
              <label>Validation Start</label>
              <input type="date" value={config.validationStartDate} onChange={(e) => setConfig({ ...config, validationStartDate: e.target.value })} />
            </div>
            <div className="config-field">
              <label>Validation End</label>
              <input type="date" value={config.validationEndDate} onChange={(e) => setConfig({ ...config, validationEndDate: e.target.value })} />
            </div>
            <div className="config-field">
              <label>Population Size</label>
              <input type="number" value={config.populationSize} onChange={(e) => setConfig({ ...config, populationSize: parseInt(e.target.value) || 50 })} min={10} max={500} />
            </div>
            <div className="config-field">
              <label>Test Start (optional)</label>
              <input type="date" value={config.testStartDate} onChange={(e) => setConfig({ ...config, testStartDate: e.target.value })} />
            </div>
            <div className="config-field">
              <label>Test End (optional)</label>
              <input type="date" value={config.testEndDate} onChange={(e) => setConfig({ ...config, testEndDate: e.target.value })} />
            </div>
            <div className="config-field">
              <label>Min Validation Samples</label>
              <input type="number" value={config.minValidationSamples} onChange={(e) => setConfig({ ...config, minValidationSamples: parseInt(e.target.value) || 50 })} min={10} />
            </div>
          </div>
          <div className="config-field checkbox-field">
            <label>
              <input type="checkbox" checked={config.applyToModel} onChange={(e) => setConfig({ ...config, applyToModel: e.target.checked })} />
              {' '}Apply best configuration as active model (archives current model)
            </label>
          </div>
          <div className="config-actions">
            <button className="btn btn-primary" onClick={runOptimization} disabled={running}>
              {running ? <><RefreshCw size={16} className="spin" /> Optimizing...</> : <><Play size={16} /> Run Optimization</>}
            </button>
          </div>
          {error && <div className="alert alert-error" style={{ marginTop: 16 }}><AlertTriangle size={18} /><span>{error}</span></div>}
        </div>
      </section>

      {/* Last Result */}
      {result && (
        <section className="section">
          <h2 className="section-title"><TrendingUp size={20} />Latest Optimization Result</h2>
          <div className="panel">
            <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>
          </div>
        </section>
      )}

      {/* History */}
      <section className="section">
        <h2 className="section-title"><History size={20} />Optimization History</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Configs Tested</th>
                <th>Validation Period</th>
                <th>Best 4-Hit Rate</th>
                <th>Best Avg Hits</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {history.map((run) => (
                <tr key={run.id}>
                  <td>#{run.id}</td>
                  <td><span className={`status-badge ${run.status === 'completed' ? 'status-success' : 'status-error'}`}>{run.status}</span></td>
                  <td>{run.configsTested}</td>
                  <td>{run.validationPeriod.startDate} → {run.validationPeriod.endDate}</td>
                  <td>{run.bestMetrics.fourHitRate !== null ? `${(run.bestMetrics.fourHitRate * 100).toFixed(2)}%` : '—'}</td>
                  <td>{run.bestMetrics.avgHits !== null ? run.bestMetrics.avgHits.toFixed(3) : '—'}</td>
                  <td>{run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={7} className="empty-cell">No optimization runs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
