import { useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles, Target, TrendingUp, Wand2 } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate, formatDateTime } from '@/lib/useAsync';
import { useAuth } from '@/lib/auth';
import {
  Badge,
  Balls,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PanelHeader,
  ProgressBar,
  Spinner,
  Tabs,
  percent,
} from '@/components/ui';

export default function Predictions() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
  const { isAdmin } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const latest = useAsync(() => api.getLatestPrediction(drawType), [drawType]);
  const model = useAsync(() => api.getActiveModel(drawType), [drawType]);
  const backtest = useAsync(() => api.getBacktestLatest(drawType), [drawType]);
  const history = useAsync(() => api.getPredictionHistory(drawType, 20), [drawType]);

  const label = drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime';
  const prediction = latest.data?.prediction;
  const bt = backtest.data?.backtest;
  const activeModel = model.data?.model;

  const resolved = (history.data?.predictions ?? []).filter((p) => p.mainHits != null);
  const avgHits = resolved.length
    ? resolved.reduce((sum, p) => sum + (p.mainHits ?? 0), 0) / resolved.length
    : null;
  const topWeights = activeModel
    ? Object.entries(activeModel.weights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];
  const maxWeight = topWeights.length ? Math.max(...topWeights.map(([, value]) => value)) : 1;

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      await api.generatePrediction({ drawType });
      latest.reload();
      model.reload();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Could not generate a prediction');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Product</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Today’s Predictions</h1>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            items={[
              { value: 'lunchtime', label: 'Lunchtime' },
              { value: 'teatime', label: 'Teatime' },
            ]}
            value={drawType}
            onChange={(value) => setDrawType(value as DrawType)}
          />
          {isAdmin ? (
            <Button size="sm" variant="secondary" onClick={handleGenerate} loading={generating}>
              <Wand2 size={15} /> Generate
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => latest.reload()} aria-label="Refresh">
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>

      {generateError ? (
        <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">
          {generateError}
        </div>
      ) : null}

      {latest.loading ? (
        <Card>
          <Spinner label={`Loading ${label} prediction…`} />
        </Card>
      ) : latest.error && latest.status !== 404 ? (
        <ErrorState message={latest.error} onRetry={latest.reload} />
      ) : !prediction ? (
        <Card>
          <EmptyState
            icon={<Target size={20} />}
            title={`No ${label} prediction available`}
            description={
              isAdmin
                ? 'Historical draws are loaded — generate the first prediction for this session.'
                : 'The model generates a prediction for each session once history is available.'
            }
            action={isAdmin ? (
              <Button onClick={handleGenerate} loading={generating}>
                <Wand2 size={15} /> Generate {label} prediction
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="app-gradient border-b border-[var(--line)] px-6 py-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Badge tone="gold">
                  <Sparkles size={12} /> {label}
                </Badge>
                <span className="text-[12.5px] text-[var(--text-3)]">{formatDate(prediction.predictionDate)}</span>
              </div>
              <Badge tone={prediction.status === 'pending' || prediction.status === 'generated' ? 'neutral' : 'mint'}>
                {prediction.status === 'pending' || prediction.status === 'generated'
                  ? 'Awaiting draw'
                  : `${prediction.mainHits ?? 0} hits${prediction.boosterHit ? ' · booster' : ''}`}
              </Badge>
            </div>

            <div className="mt-6">
              <p className="eyebrow">Main numbers</p>
              <div className="mt-3">
                <Balls main={prediction.predictedMain} size="lg" />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-end gap-10">
              <div>
                <p className="eyebrow">Booster</p>
                <div className="mt-3">
                  <Balls main={[]} booster={prediction.predictedBooster} size="lg" />
                </div>
              </div>
              {prediction.actualMain && prediction.actualMain.length > 0 ? (
                <div>
                  <p className="eyebrow">Actual draw</p>
                  <div className="mt-3">
                    <Balls main={prediction.actualMain} booster={prediction.actualBooster} size="sm" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 px-6 py-5 sm:grid-cols-3">
            <div>
              <p className="eyebrow">Model used</p>
              <p className="mono mt-1.5 text-[13px] text-[var(--text)]">{prediction.modelVersion ?? '—'}</p>
            </div>
            <div>
              <p className="eyebrow">Generated</p>
              <p className="mt-1.5 text-[13px] text-[var(--text)]">{formatDateTime(prediction.createdAt)}</p>
            </div>
            <div>
              <p className="eyebrow">Training cutoff</p>
              <p className="mt-1.5 text-[13px] text-[var(--text)]">{formatDate(prediction.trainingCutoff)}</p>
            </div>
          </div>

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-6 py-4">
              <Button size="sm" variant="secondary" onClick={handleGenerate} loading={generating}>
                <Wand2 size={14} /> Regenerate
              </Button>
              {generateError ? <span className="text-[12px] text-[var(--coral)]">{generateError}</span> : null}
            </div>
          ) : null}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <PanelHeader title="Historical performance" subtitle={`${label} · recent predictions`} />
          <div className="px-5 py-5">
            <p className="stat-value">{avgHits != null ? avgHits.toFixed(2) : '—'}</p>
            <p className="mt-1 text-[12px] text-[var(--text-3)]">
              Average main hits across {resolved.length} resolved predictions
            </p>
            <div className="mt-4 space-y-2">
              {[4, 3, 2, 1, 0].map((hits) => {
                const count = resolved.filter((p) => p.mainHits === hits).length;
                const pct = resolved.length ? (count / resolved.length) * 100 : 0;
                return (
                  <div key={hits} className="flex items-center gap-3">
                    <span className="mono w-8 text-[11.5px] text-[var(--text-3)]">{hits} hit</span>
                    <div className="flex-1">
                      <ProgressBar value={pct} tone={hits >= 3 ? 'mint' : 'gold'} />
                    </div>
                    <span className="mono w-10 text-right text-[11.5px] text-[var(--text-2)]">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card>
          <PanelHeader title="Backtest statistics" subtitle="Walk-forward, out-of-sample" right={<TrendingUp size={16} className="text-[var(--text-3)]" />} />
          {backtest.loading ? (
            <Spinner />
          ) : !bt ? (
            <EmptyState title="No backtest yet" description="Backtest results appear once a run has completed." />
          ) : (
            <div className="space-y-4 px-5 py-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="eyebrow">Avg hits</p>
                  <p className="stat-value-sm mt-1">{bt.superhybrid.avgMainHits.toFixed(2)}</p>
                </div>
                <div>
                  <p className="eyebrow">4-hit rate</p>
                  <p className="stat-value-sm mt-1">{percent(bt.superhybrid.fourHitRate)}</p>
                </div>
                <div>
                  <p className="eyebrow">Booster rate</p>
                  <p className="stat-value-sm mt-1">{percent(bt.superhybrid.boosterHitRate)}</p>
                </div>
                <div>
                  <p className="eyebrow">Draws</p>
                  <p className="stat-value-sm mt-1">{bt.totalPredictions}</p>
                </div>
              </div>
              <div className="card-2 p-3 text-[12px]">
                <div className="flex justify-between text-[var(--text-2)]">
                  <span>Model avg hits</span>
                  <span className="mono text-[var(--text)]">{bt.superhybrid.avgMainHits.toFixed(2)}</span>
                </div>
                <div className="mt-1.5 flex justify-between text-[var(--text-3)]">
                  <span>Random baseline</span>
                  <span className="mono">{bt.baselines.random.avgMainHits.toFixed(2)}</span>
                </div>
                <div className="mt-1.5 flex justify-between text-[var(--text-3)]">
                  <span>Frequency baseline</span>
                  <span className="mono">{bt.baselines.frequency.avgMainHits.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <PanelHeader title="Model" subtitle={activeModel ? `Version ${activeModel.version}` : 'Active model'} />
          {model.loading ? (
            <Spinner />
          ) : !activeModel ? (
            <EmptyState title="No active model" description="A model is trained from validated history." />
          ) : (
            <div className="space-y-4 px-5 py-5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="mint">{activeModel.status}</Badge>
                <Badge tone="sky">{activeModel.lookbackWindow} draw lookback</Badge>
              </div>
              <div>
                <p className="eyebrow">Feature weights</p>
                <div className="mt-3 space-y-2">
                  {topWeights.map(([name, value]) => (
                    <div key={name} className="flex items-center gap-3">
                      <span className="w-24 truncate text-[11.5px] text-[var(--text-3)]">{name}</span>
                      <div className="flex-1">
                        <ProgressBar value={(value / maxWeight) * 100} tone="sky" />
                      </div>
                      <span className="mono w-12 text-right text-[11.5px] text-[var(--text-2)]">
                        {value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="card-2 flex items-start gap-3 p-4">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[var(--gold)]" />
        <p className="text-[12px] leading-relaxed text-[var(--text-2)]">
          These predictions are the output of statistical models applied to historical data. UK49s draws are
          random and independent — no prediction can guarantee a result.
        </p>
      </div>
    </div>
  );
}