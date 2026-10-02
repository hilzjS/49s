import { useEffect, useState } from 'react';
import { FlaskConical, GitCompareArrows, Play } from 'lucide-react';
import { api, getAdminKey, type BacktestHistoryItem, type BacktestRun, type DrawType } from '@/lib/api';
import { useAsync, formatDate, formatDateTime } from '@/lib/useAsync';
import {
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

/** Shifts a YYYY-MM-DD date by whole days without any timezone drift. */
function shiftDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function AdminBacktesting() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
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

  // Seed a ~6-month window that ends before the latest recorded draw so the
  // backtest is genuinely out-of-sample.
  useEffect(() => {
    if (!latestDate) return;
    const end = shiftDays(latestDate, -1);
    setStartDate(shiftDays(end, -180));
    setEndDate(end);
  }, [drawType, latestDate]);

  async function runBacktest() {
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Backtesting</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            Walk-forward validation with the engine — each target draw is predicted using only older draws.
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
        <div className="rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-4 py-3 text-[12.5px] text-[#9ff0d0]">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">
          {error}
        </div>
      ) : null}

      <Card>
        <PanelHeader
          title="Run backtest"
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
          <Button onClick={runBacktest} loading={busy} disabled={!startDate || !endDate || !getAdminKey()}>
            <Play size={15} /> Run backtest
          </Button>
          {!getAdminKey() ? (
            <span className="pb-1 text-[11.5px] text-[var(--text-3)]">
              Add the admin key on the Scraper page to enable this.
            </span>
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
              hint={result.testPeriod.startDate === result.testPeriod.endDate ? formatDate(result.testPeriod.startDate) : `${formatDate(result.testPeriod.startDate)} → ${formatDate(result.testPeriod.endDate)}`}
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
                    {entry.lines} · {percent(entry.pct)}
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
