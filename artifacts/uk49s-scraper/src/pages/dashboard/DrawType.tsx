import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin';
import {
  AlertTriangle,
  CalendarDays,
  RefreshCw,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';

interface DrawInfo {
  drawDate: string;
  mainNumbers: number[];
  boosterBall: number;
}

interface PredictionInfo {
  id: number;
  predictionDate: string;
  predictedMain: number[];
  predictedBooster: number;
  modelVersion: string | null;
  trainingCutoff: string;
  mainHits: number | null;
  boosterHit: boolean | null;
  status: string;
}

interface ModelInfo {
  version: string;
  lookbackWindow: number;
  validationMetrics: { fourHitRate: number; avgHits: number; sampleSize: number } | null;
}

interface Props {
  drawType: 'lunchtime' | 'teatime';
  title: string;
  subtitle: string;
}

function LotteryBall({ number, booster = false }: { number: number; booster?: boolean }) {
  return (
    <span className={`lottery-ball ${booster ? 'lottery-ball-booster' : ''}`}>
      {String(number).padStart(2, '0')}
    </span>
  );
}

export default function DrawTypePage({ drawType, title, subtitle }: Props) {
  const [latestDraws, setLatestDraws] = useState<DrawInfo[]>([]);
  const [latestPrediction, setLatestPrediction] = useState<PredictionInfo | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [history, setHistory] = useState<PredictionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, [drawType]);

  async function fetchAll() {
    setLoading(true);
    try {
      const [drawsRes, predRes, modelRes, histRes] = await Promise.all([
        fetch(`/api/data/latest/${drawType}?limit=10`),
        fetch(`/api/predictions/latest/${drawType}`),
        fetch(`/api/predictions/model/${drawType}`),
        fetch(`/api/predictions/history/${drawType}?limit=10`),
      ]);
      if (drawsRes.ok) setLatestDraws((await drawsRes.json()).draws || []);
      if (predRes.ok) setLatestPrediction((await predRes.json()).prediction);
      if (modelRes.ok) setModel((await modelRes.json()).model);
      if (histRes.ok) setHistory((await histRes.json()).predictions || []);
    } catch (e) {
      console.error('Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setActionError(null);
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await adminFetch('/api/predictions/generate', {
        method: 'POST',
        body: JSON.stringify({ drawType, predictionDate: tomorrow.toISOString().split('T')[0] }),
      });
      await fetchAll();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to generate prediction');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <RefreshCw className="spin" size={32} />
        <p>Loading {title} data...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-drawtype">
      <div className="page-intro">
        <div>
          <div className="overline"><span className="overline-line" />{title.toUpperCase()} DATASET</div>
          <h1>{title} <em>Analysis</em></h1>
          <p>{subtitle} This dataset and its model are completely independent from the other draw type.</p>
        </div>
      </div>

      {/* Model Status */}
      <section className="section">
        <h2 className="section-title"><TrendingUp size={20} />Model Status</h2>
        <div className="panel">
          {model ? (
            <div className="model-details">
              <div className="model-field">
                <span className="field-label">Version</span>
                <span className="field-value">{model.version}</span>
              </div>
              <div className="model-field">
                <span className="field-label">Lookback</span>
                <span className="field-value">{model.lookbackWindow} draws</span>
              </div>
              {model.validationMetrics && (
                <>
                  <div className="model-field">
                    <span className="field-label">Validation 4-Hit Rate</span>
                    <span className="field-value">{(model.validationMetrics.fourHitRate * 100).toFixed(2)}%</span>
                  </div>
                  <div className="model-field">
                    <span className="field-label">Validation Avg Hits</span>
                    <span className="field-value">{model.validationMetrics.avgHits.toFixed(3)}</span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="model-empty">No active model — run optimization to configure one.</p>
          )}
        </div>
      </section>

      {/* Latest Prediction */}
      <section className="section">
        {actionError && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={18} />
            <span>{actionError}</span>
          </div>
        )}
        <div className="section-header">
          <h2 className="section-title"><Target size={20} />Latest Prediction</h2>
          <button className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating ? <><RefreshCw size={16} className="spin" /> Generating...</> : <><Zap size={16} /> Generate</>}
          </button>
        </div>
        {latestPrediction ? (
          <div className="panel prediction-card">
            <div className="prediction-display">
              <div className="prediction-main">
                <span className="prediction-label">Main Numbers (4)</span>
                <div className="balls-container">
                  {latestPrediction.predictedMain.map((n, i) => <LotteryBall key={i} number={n} />)}
                </div>
              </div>
              <div className="prediction-vs">+</div>
              <div className="prediction-booster-section">
                <span className="prediction-label">Booster</span>
                <div className="balls-container">
                  <LotteryBall number={latestPrediction.predictedBooster} booster />
                </div>
              </div>
            </div>
            <div className="prediction-meta">
              <span>Date: {latestPrediction.predictionDate}</span>
              <span>Model: {latestPrediction.modelVersion || 'Default'}</span>
              <span>Cutoff: {latestPrediction.trainingCutoff}</span>
              {latestPrediction.mainHits !== null && <span>Hits: {latestPrediction.mainHits}/4</span>}
            </div>
          </div>
        ) : (
          <div className="panel empty-state">
            <Target size={32} />
            <p>No prediction yet for {title}.</p>
          </div>
        )}
      </section>

      {/* Recent Draws */}
      <section className="section">
        <h2 className="section-title"><CalendarDays size={20} />Recent {title} Draws</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Main Numbers</th><th>Booster</th></tr>
            </thead>
            <tbody>
              {latestDraws.map((draw) => (
                <tr key={draw.drawDate}>
                  <td className="year-cell">{draw.drawDate}</td>
                  <td>
                    <div className="balls-row">
                      {draw.mainNumbers.map((n, i) => (
                        <span key={i} className="mini-ball">{String(n).padStart(2, '0')}</span>
                      ))}
                    </div>
                  </td>
                  <td><span className="mini-ball mini-ball-booster">{String(draw.boosterBall).padStart(2, '0')}</span></td>
                </tr>
              ))}
              {latestDraws.length === 0 && (
                <tr><td colSpan={3} className="empty-cell">No draws imported yet — run ingestion from the Scraper page</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Prediction History */}
      <section className="section">
        <h2 className="section-title"><CalendarDays size={20} />Prediction History</h2>
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Predicted</th><th>Booster</th><th>Hits</th><th>Status</th></tr>
            </thead>
            <tbody>
              {history.map((pred) => (
                <tr key={pred.id}>
                  <td className="year-cell">{pred.predictionDate}</td>
                  <td>{pred.predictedMain.join(', ')}</td>
                  <td>{pred.predictedBooster}</td>
                  <td className={pred.mainHits !== null && pred.mainHits >= 3 ? 'success-cell' : ''}>
                    {pred.mainHits !== null ? `${pred.mainHits}/4${pred.boosterHit ? ' +B' : ''}` : '—'}
                  </td>
                  <td><span className={`status-badge ${pred.status === 'matched' ? 'status-success' : 'status-inactive'}`}>{pred.status}</span></td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">No prediction history</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
