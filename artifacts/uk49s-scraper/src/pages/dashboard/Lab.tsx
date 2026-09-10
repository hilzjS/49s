import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin';
import {
  AlertTriangle,
  FlaskConical,
  Play,
  RefreshCw,
  Trophy,
} from 'lucide-react';

interface VariantRow {
  id: number;
  name: string;
  modelKind: string;
  disabledFeatures: string[];
  totalPredictions: number;
  avgMainHits: number | null;
  fourHitRate: number | null;
  boosterHitRate: number | null;
  medianMainHits: number | null;
  maxMainHits: number | null;
  avgHitsVolatility: number | null;
  tStatVsRandom: number | null;
  pValueVsRandom: number | null;
  rank: number | null;
  periods: {
    periodStart: string;
    periodEnd: string;
    predictions: number;
    avgMainHits: number | null;
    fourHitRate: number | null;
    boosterHitRate: number | null;
  }[];
}

interface ExperimentRunInfo {
  id: number;
  name: string;
  kind: string;
  drawType: string;
  status: string;
  periods: { start: string; end: string }[];
  variantsTested: number;
  createdAt: string;
  completedAt: string | null;
}

interface BoosterRow {
  name: string;
  predictions: number;
  hits: number;
  hitRate: number | null;
}

const FEATURE_SHORT: Record<string, string> = {
  weightFrequency: 'Frequency',
  weightRecency: 'Recency',
  weightHotCold: 'Hot/Cold',
  weightGapAnalysis: 'Gap',
  weightPairs: 'Pairs',
  weightTriples: 'Triples',
  weightConsecutive: 'Consecutive',
  weightOddEven: 'Odd/Even',
  weightLowHigh: 'Low/High',
  weightSumRange: 'Sum/Range',
  weightPositional: 'Position',
  weightRepeat: 'Repeat',
  weightFirst3Minus2: 'First3Minus2',
};

function SignificanceBadge({ t, p }: { t: number | null; p: number | null }) {
  if (t === null || p === null) return <span className="sig-badge sig-na">n/a</span>;
  if (p < 0.05 && t > 0) return <span className="sig-badge sig-better">beats random (p={p.toFixed(3)})</span>;
  if (p < 0.05 && t < 0) return <span className="sig-badge sig-worse">below random (p={p.toFixed(3)})</span>;
  return <span className="sig-badge sig-noise">noise (p={p.toFixed(3)})</span>;
}

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<'lunchtime' | 'teatime'>('lunchtime');
  const [runs, setRuns] = useState<ExperimentRunInfo[]>([]);
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [booster, setBooster] = useState<BoosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    const run = runs.filter(r => r.drawType === activeTab && r.kind !== 'booster_model');
    if (run.length > 0) {
      loadRunDetail(run[0].id);
    } else {
      setVariants([]);
    }
    const boosterRun = runs.filter(r => r.drawType === activeTab && r.kind === 'booster_model');
    if (boosterRun.length > 0) {
      loadRunDetail(boosterRun[0].id);
    }
  }, [activeTab, runs]);

  async function loadRuns() {
    try {
      const res = await fetch('/api/experiments/runs?limit=50');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadRunDetail(runId: number) {
    try {
      const res = await fetch(`/api/experiments/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedRun(runId);
        if (data.run.kind === 'booster_model') {
          setBooster(data.boosterResults || []);
        } else {
          setVariants(data.variants || []);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function runExperiment(kind: 'ablation' | 'booster') {
    setRunning(true);
    setError(null);
    try {
      const url = kind === 'booster' ? '/api/experiments/booster' : '/api/experiments/run';
      await adminFetch(url, {
        method: 'POST',
        body: JSON.stringify({ drawType: activeTab, kind, lookbackWindow: 90, randomSeed: 42 }),
      });
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Experiment failed');
    } finally {
      setRunning(false);
    }
  }

  const ablationRuns = runs.filter(r => r.drawType === activeTab && r.kind !== 'booster_model');
  const boosterRuns = runs.filter(r => r.drawType === activeTab && r.kind === 'booster_model');
  const currentRun = ablationRuns.find(r => r.id === selectedRun) ?? ablationRuns[0];

  return (
    <div className="dashboard-lab">
      <div className="page-intro">
        <div>
          <div className="overline"><span className="overline-line" />RESEARCH</div>
          <h1>Experiment <em>Lab</em></h1>
          <p>
            Side-by-side model variants, feature ablation, multi-period walk-forward,
            and stability analysis. Every result is strictly out-of-sample.
          </p>
        </div>
      </div>

      <div className="warning-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>Research, not marketing</strong>
          <p>
            Variants are ranked honestly, including when the full model loses to simpler
            ones. "Beats random" requires a Welch t-test p &lt; 0.05 vs a paired random
            baseline on the same draws.
          </p>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'lunchtime' ? 'tab-active' : ''}`} onClick={() => setActiveTab('lunchtime')}>
          Lunchtime
        </button>
        <button className={`tab ${activeTab === 'teatime' ? 'tab-active' : ''}`} onClick={() => setActiveTab('teatime')}>
          Teatime
        </button>
      </div>

      <section className="section">
        <div className="section-header">
          <h2 className="section-title"><FlaskConical size={20} />Ablation Leaderboard — {activeTab}</h2>
          <button className="btn btn-primary" onClick={() => runExperiment('ablation')} disabled={running}>
            {running ? <><RefreshCw size={16} className="spin" /> Running (~10 min)...</> : <><Play size={16} /> Run Ablation</>}
          </button>
        </div>
        {error && <div className="alert alert-error"><AlertTriangle size={18} /><span>{error}</span></div>}

        {loading ? (
          <div className="dashboard-loading"><RefreshCw className="spin" size={28} /></div>
        ) : variants.length > 0 ? (
          <div className="panel">
            {currentRun && (
              <p className="lab-run-meta">
                Run #{currentRun.id} · {currentRun.periods.length} periods ({currentRun.periods[0]?.start.slice(0, 4)}–{currentRun.periods[currentRun.periods.length - 1]?.end.slice(0, 4)})
                · {currentRun.variantsTested} variants · completed {currentRun.completedAt ? new Date(currentRun.completedAt).toLocaleString() : '—'}
              </p>
            )}
            <table className="data-table lab-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Variant</th>
                  <th>Avg Hits</th>
                  <th>4-Hit %</th>
                  <th>Booster %</th>
                  <th>Volatility</th>
                  <th>t vs Random</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <>
                    <tr
                      key={v.id}
                      className={`lab-row ${v.rank === 1 ? 'lab-row-best' : ''}`}
                      onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                    >
                      <td>{v.rank === 1 ? <Trophy size={14} className="trophy" /> : v.rank}</td>
                      <td className="variant-name">{v.name}</td>
                      <td className="num">{v.avgMainHits?.toFixed(4)}</td>
                      <td className="num">{((v.fourHitRate ?? 0) * 100).toFixed(3)}%</td>
                      <td className="num">{((v.boosterHitRate ?? 0) * 100).toFixed(2)}%</td>
                      <td className="num">{v.avgHitsVolatility?.toFixed(3)}</td>
                      <td className="num">{v.tStatVsRandom !== null ? v.tStatVsRandom.toFixed(2) : '—'}</td>
                      <td><SignificanceBadge t={v.tStatVsRandom} p={v.pValueVsRandom} /></td>
                    </tr>
                    {expanded === v.id && (
                      <tr key={`${v.id}-detail`} className="lab-detail-row">
                        <td colSpan={8}>
                          <div className="period-grid">
                            {v.periods.map((p) => (
                              <div key={p.periodStart} className="period-cell">
                                <span className="period-year">{p.periodStart.slice(0, 4)}</span>
                                <span className="period-value">{p.avgMainHits?.toFixed(3)}</span>
                                <span className="period-sub">{p.predictions} pred</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="panel empty-state">
            <FlaskConical size={48} />
            <h3>No ablation runs for {activeTab}</h3>
            <p>Run one to compare all 19 variants across multiple years.</p>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-header">
          <h2 className="section-title"><FlaskConical size={20} />Booster Ball Model — {activeTab}</h2>
          <button className="btn btn-secondary" onClick={() => runExperiment('booster')} disabled={running}>
            {running ? <><RefreshCw size={16} className="spin" /> Running...</> : <><Play size={16} /> Run Booster Study</>}
          </button>
        </div>
        {booster.length > 0 ? (
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr><th>Model</th><th>Predictions</th><th>Hits</th><th>Hit Rate</th><th>vs Random (2.04%)</th></tr>
              </thead>
              <tbody>
                {booster.reduce<BoosterRow[]>((acc, row) => {
                  const existing = acc.find(a => a.name === row.name);
                  if (existing) {
                    existing.predictions += row.predictions;
                    existing.hits += row.hits;
                  } else {
                    acc.push({ ...row });
                  }
                  return acc;
                }, []).map((m) => {
                  const rate = m.predictions > 0 ? m.hits / m.predictions : 0;
                  return (
                    <tr key={m.name}>
                      <td className="type-cell">{m.name}</td>
                      <td>{m.predictions}</td>
                      <td>{m.hits}</td>
                      <td>{(rate * 100).toFixed(2)}%</td>
                      <td>{(rate / (1 / 49)).toFixed(2)}×</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="table-note">Random expectation: 1/49 ≈ 2.04%. A ratio near 1.00× means no edge.</p>
          </div>
        ) : (
          <div className="panel empty-state">
            <p>No booster model runs yet for {activeTab}.</p>
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="section-title">Experiment Runs</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Run</th><th>Kind</th><th>Type</th><th>Status</th><th>Variants</th><th>Created</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="lab-row" onClick={() => loadRunDetail(r.id)}>
                  <td>#{r.id}</td>
                  <td>{r.kind}</td>
                  <td>{r.drawType}</td>
                  <td><span className={`status-badge ${r.status === 'completed' ? 'status-success' : r.status === 'failed' ? 'status-error' : 'status-inactive'}`}>{r.status}</span></td>
                  <td>{r.variantsTested}</td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={6} className="empty-cell">No experiment runs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
