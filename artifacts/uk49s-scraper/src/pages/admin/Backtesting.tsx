import { useEffect, useState } from 'react';
import { GitCompareArrows, Play } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate, isoDaysAgo, shiftIsoDate } from '@/lib/useAsync';
import {
  Badge,
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

export default function AdminBacktesting() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
  const [lookbackWindow, setLookbackWindow] = useState(90);
  const [testStartDate, setTestStartDate] = useState(isoDaysAgo(180));
  const [testEndDate, setTestEndDate] = useState(isoDaysAgo(0));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useActiveModel, setUseActiveModel] = useState(true);

  const latest = useAsync(() => api.getBacktestLatest(drawType), [drawType]);
  const history = useAsync(() => api.getBacktestHistory(drawType), [drawType]);
  const summary = useAsync(() => api.getDataSummary(), []);
  const modelState = useAsync(() => api.getActiveModel(drawType), [drawType]);
  const bt = latest.data?.backtest;

  const label = drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime';
  const latestDrawDate =
    (drawType === 'lunchtime' ? summary.data?.lunchtime.latestDate : summary.data?.teatime.latestDate) ?? null;

  // The backtest only reflects the optimized model when that model's weights and
  // constraints are sent with the request. Without them the API falls back to
  // the default weights, which is a different configuration entirely.
  const activeModel = modelState.data?.model ?? null;
  const usingActiveModel = useActiveModel && activeModel !== null;
  const effectiveLookback = usingActiveModel && activeModel ? activeModel.lookbackWindow : lookbackWindow;

  // The engine closes the test window with the first draw *after* testEndDate.
  // If no such draw exists it silently returns zero predictions, so the window
  // has to stop short of the latest draw.
  useEffect(() => {
    if (!latestDrawDate) return;
    const end = shiftIsoDate(latestDrawDate, -1);
    setTestEndDate(end);
    setTestStartDate(shiftIsoDate(end, -180));
  }, [latestDrawDate]);

  async function run() {
    if (latestDrawDate && testEndDate >= latestDrawDate) {
      setMessage(null);
      setError(
        `Test end must be before the latest ${label} draw (${latestDrawDate}) — the engine needs a later draw to close the window, otherwise it returns zero predictions.`,
      );
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        drawType,
        lookbackWindow: effectiveLookback,
        testStartDate,
        testEndDate,
      };
      // Send the active model's weights and constraints so the backtest
      // evaluates the model that was actually optimized, not the defaults.
      if (usingActiveModel && activeModel) {
        body.weights = activeModel.weights;
        body.constraints = activeModel.constraints;
      }

      await api.runBacktest(body);
      setMessage(
        usingActiveModel && activeModel
          ? `Backtest completed using the active ${label} model (v${activeModel.version}, lookback ${activeModel.lookbackWindow}).`
          : 'Backtest completed and stored.',
      );
      latest.reload();
      history.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setBusy(false);
    }
  }

  const distribution = bt?.superhybrid.hitDistribution.filter((entry) => entry.hits <= 4) ?? [];
  const maxCount = distribution.length ? Math.max(...distribution.map((entry) => entry.count)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Backtesting</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            Walk-forward validation of the model against random and frequency baselines.
          </p>
        </div>
        <Tabs
          items={[
            { value: 'lunchtime', label: 'Lunchtime' },
            { value: 'teatime', label: 'Teatime' },
          ]}
          value={drawType}
          onChange={(value) => setDrawType(value as DrawType)}
        />
      </div>

      {message ? (
        <div className="rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-4 py-3 text-[12.5px] text-[#9ff0d0]">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">{error}</div>
      ) : null}

      <Card>
        <PanelHeader
          title="Run a backtest"
          subtitle="Requires the admin key (set it on the Scraper page)"
          right={<Play size={16} className="text-[var(--text-3)]" />}
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Lookback window" hint={usingActiveModel ? 'From the active model' : undefined}>
            <Input
              type="number"
              min={10}
              max={500}
              value={effectiveLookback}
              onChange={(e) => setLookbackWindow(Number(e.target.value))}
              disabled={usingActiveModel}
            />
          </Field>
          <Field label="Test start">
            <Input type="date" value={testStartDate} onChange={(e) => setTestStartDate(e.target.value)} />
          </Field>
          <Field label="Test end">
            <Input type="date" value={testEndDate} onChange={(e) => setTestEndDate(e.target.value)} />
          </Field>
          <label className="flex items-end gap-2 pb-2.5 text-[12.5px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={usingActiveModel}
              onChange={(e) => setUseActiveModel(e.target.checked)}
              disabled={!activeModel}
              className="h-4 w-4 accent-[var(--gold)]"
            />
            Use active model
          </label>
          <Button onClick={run} loading={busy}>
            <Play size={15} /> Run backtest
          </Button>
          <p className="w-full text-[11.5px] text-[var(--text-3)]">
            Latest {label} draw: <span className="mono text-[var(--text-2)]">{latestDrawDate ?? '—'}</span> · the
            window must end before it.
          </p>
          <p className="w-full text-[11.5px] text-[var(--text-3)]">
            {modelState.loading ? (
              'Loading active model…'
            ) : activeModel ? (
              <>
                Backtesting the active {label} model{' '}
                <span className="mono text-[var(--text-2)]">v{activeModel.version}</span> · lookback{' '}
                <span className="mono text-[var(--text-2)]">{activeModel.lookbackWindow}</span> · validation 4-hit{' '}
                <span className="mono text-[var(--text-2)]">{percent(activeModel.validationMetrics?.fourHitRate ?? null)}</span>{' '}
                over {activeModel.validationMetrics?.sampleSize ?? '—'} draws. Uncheck to run the default weights.
              </>
            ) : (
              `No active ${label} model yet — the backtest will run with the default weights. Apply an optimizer result to test the optimized model.`
            )}
          </p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Avg main hits" value={bt ? bt.superhybrid.avgMainHits.toFixed(2) : '—'} hint={bt ? `${bt.totalPredictions} draws` : ''} tone="mint" />
        <StatCard label="4-hit rate" value={bt ? percent(bt.superhybrid.fourHitRate) : '—'} hint={bt ? `${bt.superhybrid.fourHitCount} exact` : ''} tone="gold" />
        <StatCard label="Booster rate" value={bt ? percent(bt.superhybrid.boosterHitRate) : '—'} hint="Out-of-sample" tone="sky" />
        <StatCard label="Random baseline" value={bt ? bt.baselines.random.avgMainHits.toFixed(2) : '—'} hint="Avg hits" tone="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <PanelHeader title="Hit distribution" subtitle="Resolved predictions" right={<GitCompareArrows size={16} className="text-[var(--text-3)]" />} />
          {latest.loading ? (
            <Spinner />
          ) : latest.error ? (
            <ErrorState message={latest.error} onRetry={latest.reload} />
          ) : !bt ? (
            <EmptyState title="No backtest yet" description="Run a backtest to see the hit distribution." />
          ) : (
            <div className="space-y-3 p-5">
              {distribution.map((entry) => (
                <div key={entry.hits} className="flex items-center gap-3">
                  <span className="mono w-14 text-[11.5px] text-[var(--text-3)]">{entry.hits} hits</span>
                  <div className="flex-1">
                    <ProgressBar value={(entry.count / maxCount) * 100} tone={entry.hits >= 3 ? 'mint' : 'gold'} />
                  </div>
                  <span className="mono w-12 text-right text-[11.5px] text-[var(--text-2)]">{entry.count}</span>
                </div>
              ))}
              <div className="card-2 mt-4 space-y-2 p-3 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-2)]">Model vs random</span>
                  <span className="mono text-[var(--text)]">
                    {bt.comparison.superhybridVsRandom.avgHitsDiff >= 0 ? '+' : ''}
                    {bt.comparison.superhybridVsRandom.avgHitsDiff.toFixed(3)} hits
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-2)]">Model vs frequency</span>
                  <span className="mono text-[var(--text)]">
                    {bt.comparison.superhybridVsFrequency.avgHitsDiff >= 0 ? '+' : ''}
                    {bt.comparison.superhybridVsFrequency.avgHitsDiff.toFixed(3)} hits
                  </span>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <PanelHeader title="Backtest history" subtitle="Most recent first" />
          {history.loading ? (
            <Spinner />
          ) : !history.data?.backtests?.length ? (
            <EmptyState title="No backtests recorded" description="Completed runs appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Completed</th>
                    <th>Period</th>
                    <th>Draws</th>
                    <th>Avg hits</th>
                    <th>4-hit</th>
                    <th>vs random</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.backtests.map((run) => {
                    const diff =
                      run.avgMainHits != null && run.baselines.random.avgMainHits != null
                        ? run.avgMainHits - run.baselines.random.avgMainHits
                        : null;
                    return (
                      <tr key={run.id}>
                        <td className="strong">{formatDate(run.completedAt)}</td>
                        <td className="text-[11.5px]">
                          {formatDate(run.testPeriod.startDate)} → {formatDate(run.testPeriod.endDate)}
                        </td>
                        <td className="mono">{run.totalPredictions}</td>
                        <td className="mono">{run.avgMainHits != null ? run.avgMainHits.toFixed(2) : '—'}</td>
                        <td className="mono">{percent(run.fourHitRate)}</td>
                        <td>
                          <Badge tone={diff != null && diff >= 0 ? 'mint' : 'neutral'}>
                            {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(3)}` : '—'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
