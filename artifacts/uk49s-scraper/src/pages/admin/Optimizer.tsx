import { useEffect, useState } from 'react';
import { FlaskConical, Play } from 'lucide-react';
import { api, type DrawType } from '@/lib/api';
import { useAsync, formatDate, isoDaysAgo, shiftIsoDate } from '@/lib/useAsync';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PanelHeader,
  Spinner,
  StatCard,
  Tabs,
  percent,
} from '@/components/ui';

export default function AdminOptimizer() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
  const [maxIterations, setMaxIterations] = useState(500);
  const [validationStartDate, setValidationStartDate] = useState(isoDaysAgo(365));
  const [validationEndDate, setValidationEndDate] = useState(isoDaysAgo(180));
  const [applyToModel, setApplyToModel] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const history = useAsync(() => api.getOptimizerHistory(drawType), [drawType]);
  const summary = useAsync(() => api.getDataSummary(), []);
  const runs = history.data?.optimizationRuns ?? [];
  const best = runs.find((run) => run.bestMetrics.fourHitRate != null);

  const label = drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime';
  const latestDrawDate =
    (drawType === 'lunchtime' ? summary.data?.lunchtime.latestDate : summary.data?.teatime.latestDate) ?? null;

  // Validation is scored by the backtest engine, which closes its window with
  // the first draw after the end date — so the window must stop short of the
  // latest draw.
  useEffect(() => {
    if (!latestDrawDate) return;
    const end = shiftIsoDate(latestDrawDate, -1);
    setValidationEndDate(end);
    setValidationStartDate(shiftIsoDate(end, -180));
  }, [latestDrawDate]);

  async function run() {
    if (latestDrawDate && validationEndDate >= latestDrawDate) {
      setMessage(null);
      setError(
        `Validation end must be before the latest ${label} draw (${latestDrawDate}) — the engine needs a later draw to close the window.`,
      );
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.runOptimizer({
        drawType,
        maxIterations,
        validationStartDate,
        validationEndDate,
        applyToModel,
      });
      setMessage(
        result.newModelId
          ? `Optimizer finished and applied a new model (#${result.newModelId}).`
          : 'Optimizer finished. Best configuration stored.',
      );
      history.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimizer failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Optimizer</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            Evolve model feature weights against a validation window.
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

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Runs" value={runs.length} hint={`${drawType} history`} tone="sky" />
        <StatCard
          label="Best 4-hit rate"
          value={best ? percent(best.bestMetrics.fourHitRate) : '—'}
          hint="Validation window"
          tone="gold"
        />
        <StatCard
          label="Best avg hits"
          value={best && best.bestMetrics.avgHits != null ? best.bestMetrics.avgHits.toFixed(2) : '—'}
          hint="Validation window"
          tone="mint"
        />
      </div>

      <Card>
        <PanelHeader
          title="Run the optimizer"
          subtitle="Requires the admin key (set it on the Scraper page)"
          right={<Play size={16} className="text-[var(--text-3)]" />}
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Max iterations">
            <Input
              type="number"
              min={10}
              max={5000}
              value={maxIterations}
              onChange={(e) => setMaxIterations(Number(e.target.value))}
            />
          </Field>
          <Field label="Validation start">
            <Input type="date" value={validationStartDate} onChange={(e) => setValidationStartDate(e.target.value)} />
          </Field>
          <Field label="Validation end">
            <Input type="date" value={validationEndDate} onChange={(e) => setValidationEndDate(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pb-2.5 text-[12.5px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={applyToModel}
              onChange={(e) => setApplyToModel(e.target.checked)}
              className="h-4 w-4 accent-[var(--gold)]"
            />
            Apply best config as new model
          </label>
          <Button onClick={run} loading={busy}>
            <Play size={15} /> Run optimizer
          </Button>
          <p className="w-full text-[11.5px] text-[var(--text-3)]">
            Latest {label} draw: <span className="mono text-[var(--text-2)]">{latestDrawDate ?? '—'}</span> · the
            validation window must end before it.
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <PanelHeader title="Optimization history" subtitle="Most recent first" right={<FlaskConical size={16} className="text-[var(--text-3)]" />} />
        {history.loading ? (
          <Spinner />
        ) : runs.length === 0 ? (
          <EmptyState title="No optimizer runs yet" description="Run the optimizer to search for better weights." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Completed</th>
                  <th>Status</th>
                  <th>Configs tested</th>
                  <th>Validation window</th>
                  <th>Best avg hits</th>
                  <th>Best 4-hit</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="strong">{formatDate(run.completedAt)}</td>
                    <td>
                      <Badge tone={run.status === 'completed' ? 'mint' : 'neutral'}>{run.status}</Badge>
                    </td>
                    <td className="mono">{run.configsTested}</td>
                    <td className="text-[11.5px]">
                      {formatDate(run.validationPeriod.startDate)} → {formatDate(run.validationPeriod.endDate)}
                    </td>
                    <td className="mono">
                      {run.bestMetrics.avgHits != null ? run.bestMetrics.avgHits.toFixed(2) : '—'}
                    </td>
                    <td className="mono">{percent(run.bestMetrics.fourHitRate)}</td>
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