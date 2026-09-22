import { useState } from 'react';
import { GitCompareArrows, Play } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate, isoDaysAgo } from '@/lib/useAsync';
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

  const latest = useAsync(() => api.getBacktestLatest(drawType), [drawType]);
  const history = useAsync(() => api.getBacktestHistory(drawType), [drawType]);
  const bt = latest.data?.backtest;

  async function run() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await api.runBacktest({ drawType, lookbackWindow, testStartDate, testEndDate });
      setMessage('Backtest completed and stored.');
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
          <Field label="Lookback window">
            <Input
              type="number"
              min={10}
              max={500}
              value={lookbackWindow}
              onChange={(e) => setLookbackWindow(Number(e.target.value))}
            />
          </Field>
          <Field label="Test start">
            <Input type="date" value={testStartDate} onChange={(e) => setTestStartDate(e.target.value)} />
          </Field>
          <Field label="Test end">
            <Input type="date" value={testEndDate} onChange={(e) => setTestEndDate(e.target.value)} />
          </Field>
          <Button onClick={run} loading={busy}>
            <Play size={15} /> Run backtest
          </Button>
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