import { useEffect, useState } from 'react';
import { FlaskConical, GitCompareArrows, Play, Shuffle, TrendingUp } from 'lucide-react';
import {
  api,
  getAdminKey,
  type BacktestHistoryItem,
  type BacktestRun,
  type DrawType,
  type SuperHybridConfig,
  type SuperHybridLivePrediction,
  type SuperHybridModelMeta,
  type SuperHybridReport,
  type SuperHybridRun,
  type SuperHybridSessionMetrics,
  type SuperHybridWeights,
} from '@/lib/api';
import { useAsync, formatDate, formatDateTime } from '@/lib/useAsync';
import {
  Badge,
  Balls,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PanelHeader,
  ProgressBar,
  Spinner,
  StatCard,
  Tabs,
  percent,
} from '@/components/ui';

type ModelChoice = 'base44' | 'superhybrid';

const SESSION_LABEL: Record<DrawType, string> = { lunchtime: 'Lunchtime', teatime: 'Teatime' };

const WEIGHT_LABELS: { key: keyof SuperHybridWeights; label: string }[] = [
  { key: 'existingModel', label: 'Existing model' },
  { key: 'crossSession', label: 'Cross-session' },
  { key: 'frequency', label: 'Frequency' },
  { key: 'recency', label: 'Recency' },
  { key: 'gap', label: 'Gap / overdue' },
  { key: 'pair', label: 'Pair / co-occurrence' },
  { key: 'flipFlop', label: 'Flip-Flop' },
  { key: 'pattern', label: 'Pattern filter' },
];

/** Shifts a YYYY-MM-DD date by whole days without any timezone drift. */
function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function MetricsGrid({ metrics, title, subtitle }: { metrics: SuperHybridSessionMetrics; title: string; subtitle: string }) {
  return (
    <Card>
      <PanelHeader title={title} subtitle={subtitle} />
      <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <div>
          <p className="eyebrow">Predictions</p>
          <p className="stat-value-sm mt-1">{metrics.testedDraws}</p>
        </div>
        <div>
          <p className="eyebrow">Avg hits</p>
          <p className="stat-value-sm mt-1">{metrics.avgHits.toFixed(3)}</p>
        </div>
        <div>
          <p className="eyebrow">4-hit rate</p>
          <p className="stat-value-sm mt-1">{percent(metrics.fourHitRate)}</p>
        </div>
        <div>
          <p className="eyebrow">Booster rate</p>
          <p className="stat-value-sm mt-1">{percent(metrics.boosterRate)}</p>
        </div>
        <div>
          <p className="eyebrow">Random</p>
          <p className="stat-value-sm mt-1 text-[var(--text-2)]">{metrics.randomAvgHits.toFixed(3)}</p>
        </div>
        <div>
          <p className="eyebrow">Frequency</p>
          <p className="stat-value-sm mt-1 text-[var(--text-2)]">{metrics.frequencyAvgHits.toFixed(3)}</p>
        </div>
        <div>
          <p className="eyebrow">vs random</p>
          <p className="stat-value-sm mt-1 text-[var(--text-2)]">{percent(metrics.edgeVsRandom)}</p>
        </div>
        <div>
          <p className="eyebrow">vs frequency</p>
          <p className="stat-value-sm mt-1 text-[var(--text-2)]">{percent(metrics.edgeVsFrequency)}</p>
        </div>
      </div>
      <div className="space-y-2 border-t border-[var(--line)] p-5">
        {[...metrics.hitDistribution].reverse().map((entry) => (
          <div key={entry.hits} className="flex items-center gap-3">
            <span className="mono w-16 text-[11.5px] text-[var(--text-3)]">{entry.hits} hits</span>
            <div className="flex-1">
              <ProgressBar value={entry.pct} tone={entry.hits >= 3 ? 'mint' : 'gold'} />
            </div>
            <span className="mono w-20 text-right text-[11.5px] text-[var(--text-2)]">
              {entry.lines} · {entry.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Base44 engine backtest (unchanged behaviour, window-scoped)
// ---------------------------------------------------------------------------

function Base44Backtest({ drawType }: { drawType: DrawType }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BacktestRun | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useAsync(() => api.getDataSummary(), []);
  const history = useAsync(() => api.getBacktestHistory(drawType), [drawType]);
  const info = drawType === 'lunchtime' ? summary.data?.lunchtime : summary.data?.teatime;
  const latestDate = info?.latestDate ?? null;

  useEffect(() => {
    if (!latestDate) return;
    const end = shiftDays(latestDate, -1);
    setStartDate(shiftDays(end, -180));
    setEndDate(end);
  }, [drawType, latestDate]);

  async function run() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await api.runBacktest({ drawType, testStartDate: startDate, testEndDate: endDate });
      setResult(response.backtest);
      setMessage(
        `Backtest complete: ${response.backtest.totalPredictions} draws, avg ${response.backtest.avgHits.toFixed(3)} hits per line.`,
      );
      history.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setBusy(false);
    }
  }

  const edge = result ? result.avgHits - result.randomBaseline : null;

  return (
    <div className="space-y-4">
      {message ? (
        <div className="rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-4 py-3 text-[12.5px] text-[#9ff0d0]">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">{error}</div>
      ) : null}

      <Card>
        <PanelHeader
          title="Run backtest — Base44 engine"
          subtitle="Requires the admin key (set it on the Scraper page)"
          right={<FlaskConical size={16} className="text-[var(--text-3)]" />}
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Test start" hint="Inclusive">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Test end" hint="Must be before the latest draw">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Button onClick={run} loading={busy} disabled={!startDate || !endDate || !getAdminKey()}>
            <Play size={15} /> Run backtest
          </Button>
          {!getAdminKey() ? (
            <span className="pb-1 text-[11.5px] text-[var(--text-3)]">Add the admin key on the Scraper page to enable this.</span>
          ) : null}
        </div>
      </Card>

      {result ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Avg hits / line" value={result.avgHits.toFixed(3)} hint="Main numbers matched" icon={<GitCompareArrows size={17} />} tone="mint" />
            <StatCard label="Best line" value={result.bestHits} hint="Most matches in one line" icon={<FlaskConical size={17} />} tone="gold" />
            <StatCard label="Random baseline" value={result.randomBaseline.toFixed(3)} hint="Expected by chance" tone="sky" />
            <StatCard
              label="Edge vs random"
              value={edge != null ? `${edge >= 0 ? '+' : ''}${edge.toFixed(3)}` : '—'}
              hint={`${formatDate(result.testPeriod.startDate)} → ${formatDate(result.testPeriod.endDate)}`}
              tone={edge != null && edge > 0 ? 'violet' : 'coral'}
            />
          </div>
          <Card>
            <PanelHeader title="Hit distribution" subtitle={`${result.totalPredictions} backtested draws`} />
            <div className="space-y-2 p-5">
              {[...result.hitDistribution].reverse().map((entry) => (
                <div key={entry.hits} className="flex items-center gap-3">
                  <span className="mono w-16 text-[11.5px] text-[var(--text-3)]">{entry.hits} hits</span>
                  <div className="flex-1">
                    <ProgressBar value={entry.pct} tone={entry.hits >= 3 ? 'mint' : 'gold'} />
                  </div>
                  <span className="mono w-20 text-right text-[11.5px] text-[var(--text-2)]">
                    {entry.lines} · {entry.pct.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <PanelHeader title="Backtest history" subtitle="Most recent first" right={<GitCompareArrows size={16} className="text-[var(--text-3)]" />} />
        {history.loading ? (
          <Spinner />
        ) : history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : !history.data?.backtests?.length ? (
          <EmptyState title="No backtests yet" description="Run a backtest to see results here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Completed</th>
                  <th>Test period</th>
                  <th>Draws</th>
                  <th>Avg hits</th>
                  <th>Best</th>
                  <th>4-hit rate</th>
                  <th>Random</th>
                </tr>
              </thead>
              <tbody>
                {history.data.backtests.map((run: BacktestHistoryItem) => (
                  <tr key={run.id}>
                    <td className="strong">{formatDateTime(run.completedAt)}</td>
                    <td>
                      {formatDate(run.testPeriod.startDate)} → {formatDate(run.testPeriod.endDate)}
                    </td>
                    <td className="mono">{run.totalPredictions}</td>
                    <td className="mono">{run.avgHits != null ? run.avgHits.toFixed(3) : '—'}</td>
                    <td className="mono">{run.bestHits ?? '—'}</td>
                    <td className="mono">{percent(run.fourHitRate)}</td>
                    <td className="mono">{run.randomBaseline != null ? run.randomBaseline.toFixed(3) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuperHybrid cross-session backtest
// ---------------------------------------------------------------------------

function LivePrediction() {
  // The latest actual draw drives the call — no session is requested.
  const state = useAsync(() => api.getSuperHybridPrediction(), []);
  const prediction: SuperHybridLivePrediction | undefined = state.data?.prediction;

  return (
    <Card>
      <PanelHeader
        title="Live flip-flop call"
        subtitle={state.data?.error ?? 'Latest actual draw → opposite session'}
        right={<Shuffle size={16} className="text-[var(--text-3)]" />}
      />
      {state.loading ? (
        <Spinner />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : !prediction ? (
        <EmptyState title="No flip-flop call available" description={state.data?.error ?? 'A prediction needs a latest draw, an opposite-session successor and enough history.'} />
      ) : (
        <div className="space-y-4 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="sky">
              Source: {SESSION_LABEL[prediction.cycle.sourceSession].toUpperCase()} {prediction.cycle.sourceDate}
            </Badge>
            <Badge tone="violet">Predicting {SESSION_LABEL[prediction.cycle.targetSession].toUpperCase()}</Badge>
            <Badge>{formatDate(prediction.targetDate)}</Badge>
          </div>
          <p className="text-[11.5px] text-[var(--text-3)]">
            Cycle key <span className="mono">{prediction.cycleKey}</span> — idempotent; a new draw flips the direction.
          </p>
          <div>
            <p className="eyebrow">Source numbers</p>
            <div className="mt-2">
              <Balls main={prediction.source.numbers} booster={prediction.source.bonus_numbers[0]} size="sm" />
            </div>
          </div>
          <div>
            <p className="eyebrow">Prediction</p>
            <div className="mt-2">
              <Balls main={prediction.numbers} booster={prediction.bonus_numbers[0]} size="lg" />
            </div>
          </div>
          <p className="text-[11.5px] text-[var(--text-3)]">
            {prediction.sourceLabel} · confidence {percent(prediction.confidence)} · {prediction.version}
          </p>
        </div>
      )}
    </Card>
  );
}

function ConfigCard({ config }: { config: SuperHybridConfig }) {
  const weights = WEIGHT_LABELS.map(({ key, label }) => ({ key, label, value: config.weights[key] }));
  const max = Math.max(0.001, ...weights.map((w) => w.value));
  return (
    <Card>
      <PanelHeader
        title="SuperHybrid configuration"
        subtitle={`${config.version} · model config ${config.id ?? '—'} · ${config.lookback} draw lookback`}
        right={<TrendingUp size={16} className="text-[var(--text-3)]" />}
      />
      <div className="space-y-3 p-5">
        {weights.map((weight) => (
          <div key={weight.key} className="flex items-center gap-3">
            <span className="w-36 truncate text-[11.5px] text-[var(--text-3)]">{weight.label}</span>
            <div className="flex-1">
              <ProgressBar value={(weight.value / max) * 100} tone="violet" />
            </div>
            <span className="mono w-12 text-right text-[11.5px] text-[var(--text-2)]">{weight.value.toFixed(2)}</span>
          </div>
        ))}
        <p className="text-[11.5px] text-[var(--text-3)]">
          Weights are configured for the strategy — they are not auto-optimised.
        </p>
      </div>
    </Card>
  );
}

function ExampleCard({ run, direction }: { run: SuperHybridRun | null; direction: string }) {
  if (!run) return null;
  return (
    <Card>
      <PanelHeader title={direction} subtitle="Concrete out-of-sample example" />
      <div className="space-y-3 p-5">
        <p className="text-[12px] text-[var(--text-2)]">
          Target <span className="mono text-[var(--text)]">{SESSION_LABEL[run.target_session].toUpperCase()} {run.target_date}</span>
          {' · '}Source <span className="mono text-[var(--text)]">{SESSION_LABEL[run.source_session].toUpperCase()} {run.source_date}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-3)]">
          <span className="w-24">Source</span>
          <Balls main={run.source_numbers} booster={undefined} size="sm" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-3)]">
          <span className="w-24">Prediction</span>
          <Balls main={run.predicted} booster={run.predicted_booster} size="sm" />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-3)]">
          <span className="w-24">Actual</span>
          <Balls main={run.actual} booster={run.actual_booster} size="sm" />
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={run.mainHits >= 3 ? 'mint' : 'neutral'}>{run.mainHits} main hits</Badge>
          <Badge tone={run.boosterHit ? 'gold' : 'neutral'}>{run.boosterHit ? 'booster hit' : 'no booster'}</Badge>
        </div>
      </div>
    </Card>
  );
}

function SuperHybridBacktest() {
  const [drawType, setDrawType] = useState<DrawType | 'both'>('both');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<SuperHybridModelMeta | null>(null);
  const [report, setReport] = useState<SuperHybridReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = useAsync(() => api.getSuperHybridConfig('lunchtime'), []);

  async function run() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await api.runSuperHybridBacktest({
        drawType: drawType === 'both' ? null : drawType,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setReport(response.report);
      setMeta(response.model);
      setMessage(
        response.report.testedDraws === 0
          ? (response.message ?? 'No flip-flop steps could be resolved for this window — zero predictions.')
          : `SuperHybrid backtest complete: ${response.report.testedDraws} predictions (LUNCH ${response.report.bySession.lunchtime.testedDraws} · TEA ${response.report.bySession.teatime.testedDraws}).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SuperHybrid backtest failed');
    } finally {
      setBusy(false);
    }
  }

  const directionLabel = (session: DrawType) => {
    const source = session === 'teatime' ? 'LUNCH' : 'TEA';
    return `${source} → ${SESSION_LABEL[session].toUpperCase()}`;
  };

  return (
    <div className="space-y-4">
      {message ? (
        <div className="rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-4 py-3 text-[12.5px] text-[#9ff0d0]">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">{error}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {config.data?.config ? <ConfigCard config={config.data.config} /> : <Card><Spinner /></Card>}
        <LivePrediction />
      </div>

      <Card>
        <PanelHeader
          title="Run backtest — SuperHybrid"
          subtitle="Cross-session walk-forward · same sample for model, random and frequency"
          right={<Shuffle size={16} className="text-[var(--text-3)]" />}
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <div className="flex flex-col gap-1.5 pb-1">
            <span className="label">Target session</span>
            <Tabs
              items={[
                { value: 'both', label: 'Both' },
                { value: 'lunchtime', label: 'Lunchtime' },
                { value: 'teatime', label: 'Teatime' },
              ]}
              value={drawType}
              onChange={(value) => setDrawType(value as DrawType | 'both')}
            />
          </div>
          <Field label="Start (optional)">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End (optional)">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Button onClick={run} loading={busy} disabled={!getAdminKey()}>
            <Play size={15} /> Run SuperHybrid backtest
          </Button>
          {!getAdminKey() ? (
            <span className="pb-1 text-[11.5px] text-[var(--text-3)]">Add the admin key on the Scraper page to enable this.</span>
          ) : null}
        </div>
      </Card>

      {report && meta ? (
        <div className="space-y-4">
          <Card>
            <PanelHeader title="Model" subtitle="What was evaluated" />
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <div>
                <p className="eyebrow">Model</p>
                <p className="mono mt-1 text-[13px] text-[var(--text)]">SuperHybrid</p>
              </div>
              <div>
                <p className="eyebrow">Version</p>
                <p className="mono mt-1 text-[13px] text-[var(--text)]">{meta.version}</p>
              </div>
              <div>
                <p className="eyebrow">Model config ID</p>
                <p className="mono mt-1 text-[13px] text-[var(--text)]">{meta.modelConfigId ?? '—'}</p>
              </div>
              <div>
                <p className="eyebrow">Lookback</p>
                <p className="mono mt-1 text-[13px] text-[var(--text)]">{meta.lookback}</p>
              </div>
              <div>
                <p className="eyebrow">Predicting</p>
                <p className="mt-1 text-[13px] text-[var(--text)]">{meta.targetSession === 'both' ? 'BOTH' : SESSION_LABEL[meta.targetSession].toUpperCase()}</p>
              </div>
              <div>
                <p className="eyebrow">Using</p>
                <p className="mt-1 text-[13px] text-[var(--text)]">
                  {meta.sourceSession === 'opposite' ? 'opposite session' : `latest ${SESSION_LABEL[meta.sourceSession as DrawType].toUpperCase()}`}
                </p>
              </div>
              <div>
                <p className="eyebrow">LUNCH → TEA</p>
                <p className="stat-value-sm mt-1">{report.directions.lunchToTea.testedDraws}</p>
              </div>
              <div>
                <p className="eyebrow">TEA → LUNCH</p>
                <p className="stat-value-sm mt-1">{report.directions.teaToLunch.testedDraws}</p>
              </div>
            </div>
          </Card>

          <MetricsGrid metrics={report.overall} title="Overall" subtitle={`${report.testedDraws} cross-session predictions`} />

          <div className="grid gap-4 lg:grid-cols-2">
            <MetricsGrid
              metrics={report.bySession.teatime}
              title="LUNCH → TEA"
              subtitle="Latest preceding LUNCH → TEA target"
            />
            <MetricsGrid
              metrics={report.bySession.lunchtime}
              title="TEA → LUNCH"
              subtitle="Latest preceding TEA → LUNCH target"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ExampleCard run={report.examples.lunchToTea} direction={directionLabel('teatime')} />
            <ExampleCard run={report.examples.teaToLunch} direction={directionLabel('lunchtime')} />
          </div>

          <Card>
            <PanelHeader title="Component diagnostics" subtitle="Average weighted contribution over the predicted lines" />
            <div className="space-y-2 p-5">
              {report.diagnostics.map((item) => {
                const max = Math.max(0.001, ...report.diagnostics.map((d) => d.average));
                const label = WEIGHT_LABELS.find((w) => w.key === item.component)?.label ?? item.component;
                return (
                  <div key={item.component} className="flex items-center gap-3">
                    <span className="w-36 truncate text-[11.5px] text-[var(--text-3)]">{label}</span>
                    <div className="flex-1">
                      <ProgressBar value={(item.average / max) * 100} tone="sky" />
                    </div>
                    <span className="mono w-12 text-right text-[11.5px] text-[var(--text-2)]">{item.average.toFixed(3)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <PanelHeader title="Resolved predictions" subtitle="Newest first — verify the cross-session direction" />
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Source</th>
                    <th>Prediction</th>
                    <th>Actual</th>
                    <th>Hits</th>
                    <th>Random</th>
                    <th>Freq</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.runs].reverse().slice(0, 25).map((run) => (
                    <tr key={`${run.target_session}-${run.target_date}`}>
                      <td className="strong">
                        {SESSION_LABEL[run.target_session].toUpperCase()} {run.target_date}
                      </td>
                      <td>
                        {SESSION_LABEL[run.source_session].toUpperCase()} {run.source_date}
                      </td>
                      <td className="mono">{run.predicted.join(' ')}</td>
                      <td className="mono">{run.actual.join(' ')}</td>
                      <td>
                        <Badge tone={run.mainHits >= 3 ? 'mint' : 'neutral'}>{run.mainHits}</Badge>
                      </td>
                      <td className="mono">{run.randomHits}</td>
                      <td className="mono">{run.frequencyHits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminBacktesting() {
  const [model, setModel] = useState<ModelChoice>('base44');
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Backtesting</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            Walk-forward validation. Each target draw is predicted using only information available before it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            items={[
              { value: 'base44', label: 'Base44 engine' },
              { value: 'superhybrid', label: 'SuperHybrid' },
            ]}
            value={model}
            onChange={(value) => setModel(value as ModelChoice)}
          />
          {model === 'base44' ? (
            <Tabs
              items={[
                { value: 'lunchtime', label: 'Lunchtime' },
                { value: 'teatime', label: 'Teatime' },
              ]}
              value={drawType}
              onChange={(value) => setDrawType(value as DrawType)}
            />
          ) : null}
        </div>
      </div>

      {model === 'base44' ? <Base44Backtest drawType={drawType} /> : <SuperHybridBacktest />}
    </div>
  );
}
