import { useState, useEffect } from 'react';
import {
  BarChart3,
  CalendarDays,
  CheckCircle,
  Clock3,
  Database,
  Download,
  Globe,
  RefreshCw,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';

interface DataSummary {
  success: boolean;
  lunchtime: {
    totalDraws: number;
    earliestDate: string | null;
    latestDate: string | null;
    yearCounts: { year: number; count: number }[];
  };
  teatime: {
    totalDraws: number;
    earliestDate: string | null;
    latestDate: string | null;
    yearCounts: { year: number; count: number }[];
  };
}

interface PredictionInfo {
  id: number;
  drawType: string;
  predictionDate: string;
  predictedMain: number[];
  predictedBooster: number;
  mainHits: number | null;
  boosterHit: boolean | null;
  status: string;
}

interface ModelInfo {
  id: number;
  drawType: string;
  version: string;
  lookbackWindow: number;
  validationMetrics: {
    fourHitRate: number;
    avgHits: number;
    sampleSize: number;
  } | null;
}

function StatTile({ 
  label, 
  value, 
  subValue, 
  accent = 'yellow',
  icon: Icon = Database,
}: { 
  label: string; 
  value: string | number; 
  subValue?: string;
  accent?: 'yellow' | 'coral' | 'blue' | 'green';
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="stat-tile" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className={`stat-accent stat-accent-${accent}`} />
      <div className="stat-icon"><Icon size={20} /></div>
      <p className="eyebrow">{label}</p>
      <p className="stat-value">{value}</p>
      {subValue && <p className="stat-hint">{subValue}</p>}
    </div>
  );
}

function LotteryBall({ number, booster = false }: { number: number; booster?: boolean }) {
  return (
    <span className={`lottery-ball ${booster ? 'lottery-ball-booster' : ''}`}>
      {String(number).padStart(2, '0')}
    </span>
  );
}

function PredictionCard({ title, prediction, model }: { title: string; prediction: PredictionInfo | null; model: ModelInfo | null }) {
  return (
    <div className="panel prediction-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{title}</p>
          <h3>Latest Prediction</h3>
        </div>
        <div className="heading-badge">
          <Target size={16} />
          {model?.version || 'No model'}
        </div>
      </div>
      
      {prediction ? (
        <div className="prediction-content">
          <div className="prediction-numbers">
            <div className="prediction-label">Main Numbers (4)</div>
            <div className="prediction-balls">
              {prediction.predictedMain.map((num, i) => (
                <LotteryBall key={i} number={num} />
              ))}
            </div>
          </div>
          <div className="prediction-numbers prediction-booster">
            <div className="prediction-label">Booster Ball</div>
            <div className="prediction-balls">
              <LotteryBall number={prediction.predictedBooster} booster />
            </div>
          </div>
          
          {prediction.mainHits !== null && (
            <div className="prediction-result">
              <div className="result-hits">
                <span className="hits-label">Hits:</span>
                <span className="hits-value">{prediction.mainHits}/4</span>
              </div>
              {prediction.boosterHit && (
                <span className="booster-badge">Booster Hit!</span>
              )}
            </div>
          )}
          
          <div className="prediction-meta">
            <span>Date: {prediction.predictionDate}</span>
            {model && (
              <span>Model: {model.version}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="prediction-empty">
          <p>No prediction available</p>
          <a className="btn btn-primary" href="/dashboard/predictions">
            Generate Prediction
          </a>
        </div>
      )}
      
      <div className="prediction-warning">
        ⚠️ These are statistical pattern predictions. Lottery outcomes are random.
      </div>
    </div>
  );
}

export default function Overview() {
  const [data, setData] = useState<DataSummary | null>(null);
  const [lunchPrediction, setLunchPrediction] = useState<PredictionInfo | null>(null);
  const [teaPrediction, setTeaPrediction] = useState<PredictionInfo | null>(null);
  const [lunchModel, setLunchModel] = useState<ModelInfo | null>(null);
  const [teaModel, setTeaModel] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        
        // Fetch data summary
        const summaryRes = await fetch('/api/data/summary');
        const summary = await summaryRes.json();
        setData(summary);
        
        // Fetch predictions
        try {
          const lunchPredRes = await fetch('/api/predictions/latest/lunchtime');
          if (lunchPredRes.ok) {
            const lunchPred = await lunchPredRes.json();
            setLunchPrediction(lunchPred.prediction);
          }
          
          const teaPredRes = await fetch('/api/predictions/latest/teatime');
          if (teaPredRes.ok) {
            const teaPred = await teaPredRes.json();
            setTeaPrediction(teaPred.prediction);
          }
        } catch (e) {
          console.log('Predictions not available');
        }
        
        // Fetch models
        try {
          const lunchModelRes = await fetch('/api/predictions/model/lunchtime');
          if (lunchModelRes.ok) {
            const lunchM = await lunchModelRes.json();
            setLunchModel(lunchM.model);
          }
          
          const teaModelRes = await fetch('/api/predictions/model/teatime');
          if (teaModelRes.ok) {
            const teaM = await teaModelRes.json();
            setTeaModel(teaM.model);
          }
        } catch (e) {
          console.log('Models not available');
        }
        
        setError(null);
      } catch (e) {
        setError('Failed to load data. Make sure the API server is running.');
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <RefreshCw className="spin" size={32} />
        <p>Loading platform data...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-overview">
      <div className="page-intro">
        <div>
          <div className="overline">
            <span className="overline-line" />
            UK49S PREDICTION PLATFORM
          </div>
          <h1>Platform <em>Overview</em></h1>
          <p>
            Historical data analysis, statistical predictions, and performance metrics 
            for UK49s Lunchtime and Teatime draws.
          </p>
        </div>
      </div>
      
      {error && (
        <div className="alert alert-error">
          <XCircle size={18} />
          <span>{error}</span>
        </div>
      )}
      
      {/* Data Stats */}
      <section className="section">
        <h2 className="section-title">
          <Database size={20} />
          Historical Data
        </h2>
        <div className="stat-grid stat-grid-4">
          <StatTile 
            label="Total Lunch Draws" 
            value={data?.lunchtime.totalDraws || 0}
            subValue={`From ${data?.lunchtime.earliestDate || 'N/A'}`}
            accent="yellow"
            icon={CalendarDays}
          />
          <StatTile 
            label="Total Tea Draws" 
            value={data?.teatime.totalDraws || 0}
            subValue={`From ${data?.teatime.earliestDate || 'N/A'}`}
            accent="coral"
            icon={CalendarDays}
          />
          <StatTile 
            label="Lunch Years" 
            value={data?.lunchtime.yearCounts.length || 0}
            subValue={`Latest: ${data?.lunchtime.latestDate || 'N/A'}`}
            accent="blue"
            icon={Globe}
          />
          <StatTile 
            label="Tea Years" 
            value={data?.teatime.yearCounts.length || 0}
            subValue={`Latest: ${data?.teatime.latestDate || 'N/A'}`}
            accent="green"
            icon={Globe}
          />
        </div>
      </section>
      
      {/* Latest Predictions */}
      <section className="section">
        <h2 className="section-title">
          <Target size={20} />
          Latest Predictions
        </h2>
        <div className="predictions-grid">
          <PredictionCard 
            title="Lunchtime" 
            prediction={lunchPrediction} 
            model={lunchModel}
          />
          <PredictionCard 
            title="Teatime" 
            prediction={teaPrediction} 
            model={teaModel}
          />
        </div>
      </section>
      
      {/* Model Status */}
      <section className="section">
        <h2 className="section-title">
          <TrendingUp size={20} />
          Active Models
        </h2>
        <div className="models-grid">
          <div className="panel model-card">
            <div className="model-header">
              <h3>Lunchtime Model</h3>
              <span className={`status-badge ${lunchModel ? 'status-active' : 'status-inactive'}`}>
                {lunchModel ? 'Active' : 'Not Set'}
              </span>
            </div>
            {lunchModel ? (
              <div className="model-details">
                <div className="model-field">
                  <span className="field-label">Version</span>
                  <span className="field-value">{lunchModel.version}</span>
                </div>
                <div className="model-field">
                  <span className="field-label">Lookback Window</span>
                  <span className="field-value">{lunchModel.lookbackWindow} draws</span>
                </div>
                {lunchModel.validationMetrics && (
                  <>
                    <div className="model-field">
                      <span className="field-label">4-Hit Rate</span>
                      <span className="field-value">{(lunchModel.validationMetrics.fourHitRate * 100).toFixed(2)}%</span>
                    </div>
                    <div className="model-field">
                      <span className="field-label">Avg Hits</span>
                      <span className="field-value">{lunchModel.validationMetrics.avgHits.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="model-empty">No active model configured</p>
            )}
          </div>
          
          <div className="panel model-card">
            <div className="model-header">
              <h3>Teatime Model</h3>
              <span className={`status-badge ${teaModel ? 'status-active' : 'status-inactive'}`}>
                {teaModel ? 'Active' : 'Not Set'}
              </span>
            </div>
            {teaModel ? (
              <div className="model-details">
                <div className="model-field">
                  <span className="field-label">Version</span>
                  <span className="field-value">{teaModel.version}</span>
                </div>
                <div className="model-field">
                  <span className="field-label">Lookback Window</span>
                  <span className="field-value">{teaModel.lookbackWindow} draws</span>
                </div>
                {teaModel.validationMetrics && (
                  <>
                    <div className="model-field">
                      <span className="field-label">4-Hit Rate</span>
                      <span className="field-value">{(teaModel.validationMetrics.fourHitRate * 100).toFixed(2)}%</span>
                    </div>
                    <div className="model-field">
                      <span className="field-label">Avg Hits</span>
                      <span className="field-value">{teaModel.validationMetrics.avgHits.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="model-empty">No active model configured</p>
            )}
          </div>
        </div>
      </section>
      
      {/* Disclaimer */}
      <div className="disclaimer-banner">
        <div className="disclaimer-icon">⚠️</div>
        <div className="disclaimer-content">
          <strong>Important Disclaimer</strong>
          <p>
            This platform provides statistical pattern analysis based on historical UK49s data. 
            Predictions are generated using mathematical models and should be treated as statistical 
            experiments, not as guaranteed winning numbers. Lottery outcomes are fundamentally 
            random and cannot be predicted with certainty. Play responsibly.
          </p>
        </div>
      </div>
    </div>
  );
}
