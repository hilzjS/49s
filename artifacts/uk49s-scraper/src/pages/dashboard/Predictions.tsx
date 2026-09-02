import { useState, useEffect } from 'react';
import { adminFetch } from '@/lib/admin';
import {
  AlertTriangle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Filter,
  History,
  RefreshCw,
  Target,
  Zap,
} from 'lucide-react';

interface PredictionInfo {
  id: number;
  drawType: string;
  predictionDate: string;
  predictedMain: number[];
  predictedBooster: number;
  modelVersion: string | null;
  trainingCutoff: string;
  status: string;
  mainHits: number | null;
  boosterHit: boolean | null;
  actualMain: number[] | null;
  actualBooster: number | null;
  createdAt: string;
}

function LotteryBall({ number, booster = false, hit = false }: { number: number; booster?: boolean; hit?: boolean }) {
  return (
    <span className={`lottery-ball ${booster ? 'lottery-ball-booster' : ''} ${hit ? 'lottery-ball-hit' : ''}`}>
      {String(number).padStart(2, '0')}
    </span>
  );
}

function PredictionCard({ prediction }: { prediction: PredictionInfo }) {
  const hasResult = prediction.mainHits !== null;
  const hits = prediction.mainHits || 0;
  
  return (
    <div className={`prediction-card-item ${hasResult ? 'has-result' : ''}`}>
      <div className="prediction-header">
        <div className="prediction-date">
          <Calendar size={14} />
          {prediction.predictionDate}
        </div>
        <div className="prediction-type">{prediction.drawType}</div>
      </div>
      
      <div className="prediction-numbers-row">
        <div className="numbers-group">
          <span className="group-label">Main (4)</span>
          <div className="balls-row">
            {prediction.predictedMain.map((num, i) => (
              <LotteryBall 
                key={i} 
                number={num} 
                hit={hasResult && prediction.actualMain?.includes(num)} 
              />
            ))}
          </div>
        </div>
        <div className="numbers-group booster-group">
          <span className="group-label">Booster</span>
          <div className="balls-row">
            <LotteryBall 
              number={prediction.predictedBooster} 
              booster 
              hit={hasResult && prediction.actualBooster === prediction.predictedBooster}
            />
          </div>
        </div>
      </div>
      
      {hasResult && (
        <div className="prediction-result">
          <div className="result-main">
            <span className="result-label">Main Hits:</span>
            <span className={`result-value ${hits >= 4 ? 'result-win' : ''}`}>
              {hits}/4
            </span>
          </div>
          {prediction.boosterHit && (
            <span className="booster-result">+ Booster!</span>
          )}
        </div>
      )}
      
      <div className="prediction-footer">
        <span>Model: {prediction.modelVersion || 'Default'}</span>
        <span>Training cutoff: {prediction.trainingCutoff}</span>
      </div>
    </div>
  );
}

export default function PredictionsPage() {
  const [lunchHistory, setLunchHistory] = useState<PredictionInfo[]>([]);
  const [teaHistory, setTeaHistory] = useState<PredictionInfo[]>([]);
  const [latestLunch, setLatestLunch] = useState<PredictionInfo | null>(null);
  const [latestTea, setLatestTea] = useState<PredictionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'lunchtime' | 'teatime'>('lunchtime');

  useEffect(() => {
    fetchPredictions();
  }, []);

  async function fetchPredictions() {
    try {
      const [lunchRes, teaRes] = await Promise.all([
        fetch('/api/predictions/history/lunchtime?limit=20'),
        fetch('/api/predictions/history/teatime?limit=20'),
      ]);
      
      if (lunchRes.ok) {
        const lunchData = await lunchRes.json();
        setLunchHistory(lunchData.predictions || []);
        if (lunchData.predictions?.[0]) {
          setLatestLunch(lunchData.predictions[0]);
        }
      }
      
      if (teaRes.ok) {
        const teaData = await teaRes.json();
        setTeaHistory(teaData.predictions || []);
        if (teaData.predictions?.[0]) {
          setLatestTea(teaData.predictions[0]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch predictions:', e);
    } finally {
      setLoading(false);
    }
  }

  async function generatePrediction(drawType: 'lunchtime' | 'teatime') {
    setGenerating(drawType);
    setActionError(null);
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];

      await adminFetch('/api/predictions/generate', {
        method: 'POST',
        body: JSON.stringify({ drawType, predictionDate: dateStr }),
      });
      await fetchPredictions();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to generate prediction');
    } finally {
      setGenerating(null);
    }
  }

  if (loading) {
    return (
      <div className="dashboard-loading">
        <RefreshCw className="spin" size={32} />
        <p>Loading predictions...</p>
      </div>
    );
  }

  const history = activeTab === 'lunchtime' ? lunchHistory : teaHistory;
  const latest = activeTab === 'lunchtime' ? latestLunch : latestTea;

  return (
    <div className="dashboard-predictions">
      <div className="page-intro">
        <div>
          <div className="overline">
            <span className="overline-line" />
            PREDICTIONS
          </div>
          <h1>Number <em>Predictions</em></h1>
          <p>
            View current and historical predictions for UK49s draws.
            Each prediction contains exactly 4 main numbers and 1 booster ball.
          </p>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="warning-banner">
        <AlertTriangle size={20} />
        <div>
          <strong>Statistical Predictions Only</strong>
          <p>
            These predictions are based on historical statistical patterns. 
            Lottery outcomes are random and cannot be guaranteed. 
            This is a mathematical analysis experiment, not a guarantee of winning.
          </p>
        </div>
      </div>

      {/* Draw Type Tabs */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'lunchtime' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('lunchtime')}
        >
          <Clock3 size={16} />
          Lunchtime Predictions
        </button>
        <button 
          className={`tab ${activeTab === 'teatime' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('teatime')}
        >
          <Clock3 size={16} />
          Teatime Predictions
        </button>
      </div>

      {/* Latest Prediction */}
      <section className="section">
        {actionError && (
          <div className="alert alert-error">
            <AlertTriangle size={18} />
            <span>{actionError}</span>
          </div>
        )}
        <div className="section-header">
          <h2 className="section-title">
            <Target size={20} />
            Latest Prediction - {activeTab}
          </h2>
          <button 
            className="btn btn-primary"
            onClick={() => generatePrediction(activeTab)}
            disabled={generating === activeTab}
          >
            {generating === activeTab ? (
              <><RefreshCw size={16} className="spin" /> Generating...</>
            ) : (
              <><Zap size={16} /> Generate New</>
            )}
          </button>
        </div>

        {latest ? (
          <div className="panel latest-prediction">
            <div className="prediction-display">
              <div className="prediction-main">
                <span className="prediction-label">Predicted Main Numbers</span>
                <div className="balls-container">
                  {latest.predictedMain.map((num, i) => (
                    <LotteryBall key={i} number={num} />
                  ))}
                </div>
                <span className="prediction-hint">4 numbers from 1-49</span>
              </div>
              
              <div className="prediction-vs">+</div>
              
              <div className="prediction-booster-section">
                <span className="prediction-label">Predicted Booster Ball</span>
                <div className="balls-container">
                  <LotteryBall number={latest.predictedBooster} booster />
                </div>
                <span className="prediction-hint">1 number from 1-49</span>
              </div>
            </div>
            
            <div className="prediction-meta-grid">
              <div className="meta-item">
                <span className="meta-label">Prediction Date</span>
                <span className="meta-value">{latest.predictionDate}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Model Version</span>
                <span className="meta-value">{latest.modelVersion || 'Default'}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Training Cutoff</span>
                <span className="meta-value">{latest.trainingCutoff}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Status</span>
                <span className="meta-value">{latest.status}</span>
              </div>
            </div>
            
            {latest.mainHits !== null && (
              <div className="prediction-outcome">
                <h4>Result</h4>
                <div className="outcome-comparison">
                  <div className="outcome-predicted">
                    <span className="outcome-label">Predicted</span>
                    <div className="balls-row">
                      {latest.predictedMain.map((num, i) => (
                        <LotteryBall 
                          key={i} 
                          number={num}
                          hit={latest.actualMain?.includes(num)}
                        />
                      ))}
                      <LotteryBall 
                        number={latest.predictedBooster} 
                        booster
                        hit={latest.actualBooster === latest.predictedBooster}
                      />
                    </div>
                  </div>
                  <div className="outcome-actual">
                    <span className="outcome-label">Actual</span>
                    <div className="balls-row">
                      {latest.actualMain?.map((num, i) => (
                        <LotteryBall key={i} number={num} />
                      ))}
                      <LotteryBall number={latest.actualBooster!} booster />
                    </div>
                  </div>
                </div>
                <div className="outcome-score">
                  Main Hits: <strong>{latest.mainHits}/4</strong>
                  {latest.boosterHit && <span className="booster-hit">Booster: HIT!</span>}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="panel empty-state">
            <Target size={48} />
            <h3>No Prediction Available</h3>
            <p>Generate a prediction to get started.</p>
            <button 
              className="btn btn-primary"
              onClick={() => generatePrediction(activeTab)}
              disabled={generating === activeTab}
            >
              <Zap size={16} />
              Generate Prediction
            </button>
          </div>
        )}
      </section>

      {/* Prediction History */}
      <section className="section">
        <h2 className="section-title">
          <History size={20} />
          Prediction History
        </h2>
        
        <div className="predictions-list">
          {history.length > 0 ? (
            history.map((pred) => (
              <PredictionCard key={pred.id} prediction={pred} />
            ))
          ) : (
            <div className="panel empty-state">
              <History size={32} />
              <p>No prediction history available</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
