import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Crosshair,
  FlaskConical,
  Play,
  ShieldCheck,
  Square,
  Target,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import {
  api,
  type DrawType,
  type OptimizerDiagnosticReport,
  type OptimizerJobState,
  type OptimizerJobStatus,
  type OptimizerStopReason,
  type OptimizerWindow,
} from '@/lib/api';
import { useAsync, formatDateTime } from '@/lib/useAsync';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PanelHeader,
  ProgressBar,
  Select,
  Spinner,
  StatCard,
  Tabs,
  percent,
} from '@/components/ui';

const MAX_CONFIGURATION_OPTIONS = [100, 500, 1000, 5000];
const FOUR_HIT_TARGET = 4;

/** Formats a YYYY-MM-DD draw date without any timezone shift. */
function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function statusTone(status: OptimizerJobStatus): 'mint' | 'sky' | 'coral' | 'gold' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'mint';
    case 'running':
      return 'sky';
    case 'queued':
      return 'gold';
    case 'failed':
      return 'coral';
    default:
      return 'neutral';
  }
}

function windowLabel(validationWindow: OptimizerWindow | null | undefined): string {
  if (!validationWindow) return '—';
  return `${formatIsoDate(validationWindow.validationStartDate)} → ${formatIsoDate(validationWindow.validationEndDate)}`;
}

/** Human explanation of why the search stopped (no performance claim). */
function stopReasonText(reason: OptimizerStopReason | null, job: OptimizerJobState | null): string {
  if (!job) return '—';
  switch (reason) {
    case 'four-hit-found':
      return `4-hit target found after ${job.configsTested} configuration${job.configsTested === 1 ? '' : 's'}.`;
    case 'max-configurations-reached':
      return `Maximum ${job.maxConfigurations ?? job.totalConfigs} configurations reached. ${
        job.fourHitFound ? 'A 4-hit configuration was also found.' : 'No 4-hit configuration found.'
      }`;
    case 'search-exhausted':
      return `Search space exhausted after ${job.configsTested} configurations. ${
        job.fourHitFound ? 'A 4-hit configuration was found.' : 'No 4-hit configuration found.'
      }`;
    default:
      return '—';
  }
}

export default function AdminOptimizer() {
  const [drawType, setDrawType] = useState<DrawType>('lunchtime');
  const [job, setJob] = useState<OptimizerJobState | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [customWindow, setCustomWindow] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [maxConfigurations, setMaxConfigurations] = useState(1000);
  const [stopOnFourHit, setStopOnFourHit] = useState(true);
  const [applyToModel, setApplyToModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<OptimizerDiagnosticReport | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);

  const preflight = useAsync(() => api.getOptimizerPreflight(drawType), [drawType]);
  const history = useAsync(() => api.getOptimizerHistory(drawType), [drawType]);

  const label = drawType === 'lunchtime' ? 'Lunchtime' : 'Teatime';
  const validationWindow = preflight.data?.window ?? null;
  const runs = history.data?.optimizationRuns ?? [];
  const isLive = job?.status === 'running' || job?.status === 'queued';
  const pollRef = useRef<number | null>(null);

  // Adopt an already-running job when the page opens (e.g. after a reload).
  useEffect(() => {
    const active = preflight.data?.activeJob ?? null;
    if (active) {
      setJob((current) => (current && current.runId === active.runId ? current : active));
    }
  }, [preflight.data]);

  // Seed the advanced custom dates from the automatically selected window.
  useEffect(() => {
    if (!validationWindow) return;
    setCustomStart((value) => value || validationWindow.validationStartDate);
    setCustomEnd((value) => value || validationWindow.validationEndDate);
  }, [validationWindow]);

  // Live progress polling. Only runs while a job is queued or running.
  useEffect(() => {
    if (!job || !isLive) return;

    const runId = job.runId;
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await api.getOptimizerStatus(runId);
        if (cancelled) return;
        setJob(response.job);
        if (response.job.status !== 'running' && response.job.status !== 'queued') {
          history.reload();
          preflight.reload();
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to read optimizer progress');
      }
    };

    const id = window.setInterval(tick, 1200);
    pollRef.current = id;
    void tick();

    return () => {
      cancelled = true;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.runId, isLive]);

  const plannedConfigurations = job?.maxConfigurations ?? job?.totalConfigs ?? maxConfigurations;
  const testedRatio =
    plannedConfigurations > 0 && job ? Math.min(100, (job.configsTested / plannedConfigurations) * 100) : 0;

  const bestEvaluatedRun = runs.find(
    (run) => run.status === 'completed' && run.bestMetrics.fourHitRate != null && run.configsTested > 0,
  );
  const fourHitRuns = useMemo(() => runs.filter((run) => run.fourHitFound), [runs]);

  const statusText = !job
    ? 'Idle'
    : job.status === 'running' || job.status === 'queued'
      ? 'Searching…'
      : job.status === 'completed'
        ? job.fourHitFound
          ? 'TARGET FOUND — 4 HITS'
          : 'Finished — no 4-hit configuration found'
        : job.status === 'failed'
          ? 'Failed'
          : 'Cancelled';

  async function runAuto() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const body: Parameters<typeof api.startOptimizerRun>[0] = {
        drawType,
        maxConfigurations,
        stopOnFourHit,
        applyToModel,
      };

      if (customWindow) {
        body.customWindow = true;
        body.validationStartDate = customStart;
        body.validationEndDate = customEnd;
      }

      const response = await api.startOptimizerRun(body);
      setJob(response.job);
      setMessage(
        `Searching for a 4-hit configuration on the ${label} model — validation ${windowLabel(response.window)} (${response.window.validationDrawCount} draws), up to ${maxConfigurations} configurations.`,
      );
      preflight.reload();
      history.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the optimizer');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.cancelOptimizerRun(job.runId);
      setJob(response.job);
      setMessage('Optimization cancelled.');
      history.reload();
      preflight.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel the optimizer');
    } finally {
      setBusy(false);
    }
  }

  async function applyBest() {
    if (!job) return;
    setApplying(true);
    setError(null);
    setMessage(null);
    try {
      const response = await api.applyOptimizerBest(job.runId);
      setMessage(
        response.fourHitFound
          ? `4-hit configuration #${response.configId} is now used for future ${label} predictions (model #${response.newModelId}).`
          : `Configuration #${response.configId} is now used for future ${label} predictions (model #${response.newModelId}).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply the configuration');
    } finally {
      setApplying(false);
    }
  }

  async function runDiagnostic() {
    setDiagnosing(true);
    setDiagnostic(null);
    setDiagnosticError(null);
    try {
      const response = await api.runOptimizerDiagnostic({ drawType, sampleSize: 10 });
      setDiagnostic(response.report);
    } catch (err) {
      setDiagnosticError(err instanceof Error ? err.message : 'Diagnostic failed');
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Optimizer</h1>
          <p className="mt-1 text-[13px] text-[var(--text-3)]">
            Searching for a configuration that produces a 4-hit result on {label} historical validation draws.
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

      {/* Target / progress panel -------------------------------------------- */}
      <Card>
        <PanelHeader
          title="Optimization target"
          subtitle={`${label} model only — Lunchtime and Teatime are optimized independently`}
          right={<Target size={16} className="text-[var(--gold)]" />}
        />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Target" value={`${FOUR_HIT_TARGET} hits`} hint="Historical validation" tone="gold" />
            <StatCard
              label="Current best"
              value={`${job?.maxHits ?? 0} hits`}
              hint="Best single prediction so far"
              tone="sky"
            />
            <StatCard
              label="Configurations tested"
              value={`${job?.configsTested ?? 0} / ${plannedConfigurations}`}
              hint="Incremented only after a real evaluation"
              tone="violet"
            />
            <StatCard
              label="4-hit results found"
              value={job?.fourHitCount ?? 0}
              hint="Configurations with a genuine 4-hit"
              tone={job?.fourHitFound ? 'mint' : 'coral'}
            />
            <StatCard label="Validation draws" value={job?.validationDrawCount ?? validationWindow?.validationDrawCount ?? '—'} tone="sky" />
            <StatCard
              label="Current best average"
              value={job?.bestAvgHits != null ? job.bestAvgHits.toFixed(2) : '—'}
              hint="Existing average-hits metric"
              tone="mint"
            />
            <StatCard
              label="Elapsed"
              value={job ? formatDuration(job.elapsedMs) : '—'}
              tone="violet"
            />
            <StatCard
              label="Status"
              value={<span className="text-[15px]">{statusText}</span>}
              hint={job?.phase ? `${job.phase} phase` : undefined}
              tone={job?.fourHitFound ? 'mint' : 'sky'}
            />
          </div>

          {job && isLive ? (
            <div className="space-y-2">
              <ProgressBar value={testedRatio} tone="violet" />
              <div className="flex flex-wrap justify-between gap-2 text-[11.5px] text-[var(--text-3)]">
                <span>
                  Current configuration:{' '}
                  <span className="mono text-[var(--text-2)]">
                    {job.currentConfig ? `lookback ${job.currentConfig.lookbackWindow}` : '—'}
                  </span>
                </span>
                <span>Searching…</span>
              </div>
            </div>
          ) : null}

          {job && !isLive && job.status !== 'failed' ? (
            <div className="rounded-lg border border-[var(--line-2)] bg-[var(--surface-2)] px-4 py-3 text-[12.5px] text-[var(--text-2)]">
              <span className="font-medium text-[var(--text)]">Stopped:</span> {stopReasonText(job.stoppedReason, job)}
            </div>
          ) : null}
        </div>
      </Card>

      {/* 4-hit result ------------------------------------------------------- */}
      {job?.fourHitFound && job.fourHit ? (
        <Card>
          <PanelHeader
            title="4-hit configuration found in historical validation"
            subtitle="A real validation prediction compared against the actual historical draw — not a guarantee of future results"
            right={<Crosshair size={16} className="text-[var(--mint)]" />}
          />
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-4 py-3 text-[13px] font-semibold text-[#9ff0d0]">
              TARGET FOUND — 4 HITS
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Configuration"
                value={job.fourHitConfigId != null ? `#${job.fourHitConfigId}` : '—'}
                tone="violet"
              />
              <StatCard
                label="Validation draw"
                value={<span className="text-[16px]">{formatIsoDate(job.fourHit.validationDrawDate)}</span>}
                tone="sky"
              />
              <StatCard label="Hits" value={job.fourHit.mainHits} tone="mint" />
              <StatCard label="Configurations tested" value={job.configsTested} tone="gold" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3">
                <p className="eyebrow">Prediction</p>
                <p className="mono mt-1.5 text-[14px] text-[var(--text)]">
                  {[...job.fourHit.predictedMain, job.fourHit.predictedBooster]
                    .map((n) => String(n).padStart(2, '0'))
                    .join(' · ')}
                </p>
              </div>
              <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3">
                <p className="eyebrow">Actual draw</p>
                <p className="mono mt-1.5 text-[14px] text-[var(--text)]">
                  {[...job.fourHit.actualMain, job.fourHit.actualBooster]
                    .map((n) => String(n).padStart(2, '0'))
                    .join(' · ')}
                </p>
              </div>
            </div>

            <p className="text-[12px] text-[var(--text-3)]">
              Validation window: {job.validationStartDate ? formatIsoDate(job.validationStartDate) : '—'} →{' '}
              {job.validationEndDate ? formatIsoDate(job.validationEndDate) : '—'} · trained only on draws before{' '}
              {formatIsoDate(job.fourHit.validationDrawDate)}.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={applyBest} loading={applying}>
                Use This Configuration For Predictions
              </Button>
              <p className="text-[11.5px] text-[var(--text-3)]">
                Applies the configuration to the existing {label} prediction system. The prediction algorithm itself is
                unchanged.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Automatic validation window + preflight checks ---------------------- */}
      <Card>
        <PanelHeader
          title="Automatic data validation"
          subtitle={`Selected from stored ${label} history — no manual dates required`}
          right={<ShieldCheck size={16} className="text-[var(--mint)]" />}
        />

        {preflight.loading ? (
          <Spinner label="Checking available history…" />
        ) : preflight.error ? (
          <div className="px-5 pb-5 text-[12.5px] text-[#ffc0b8]">{preflight.error}</div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label="Automatic validation"
                value={<span className="text-[17px]">{windowLabel(validationWindow)}</span>}
                hint={validationWindow ? `~${validationWindow.monthsCovered} months` : undefined}
                tone="violet"
              />
              <StatCard
                label="Validation draws"
                value={validationWindow?.validationDrawCount ?? '—'}
                hint={
                  validationWindow
                    ? validationWindow.usedLargestAvailableWindow
                      ? 'Largest available window'
                      : 'Most recent ~12 months'
                    : undefined
                }
                tone="sky"
              />
              <StatCard
                label={`Latest ${label} draw`}
                value={<span className="text-[17px]">{formatIsoDate(validationWindow?.latestDrawDate)}</span>}
                hint="Reserved as the next prediction reference"
                tone="gold"
              />
            </div>

            <p className="text-[12px] text-[var(--text-3)]">
              Validation ends before the latest draw, so no future draw is ever used and the predicted draw is excluded
              from its own evaluation. Training history before the window:{' '}
              <span className="mono text-[var(--text-2)]">{validationWindow?.trainingDrawsBeforeWindow ?? '—'}</span>{' '}
              draws.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {(preflight.data?.checks ?? []).map((check) => (
                <div key={check.name} className="flex items-start gap-2.5 rounded-lg bg-[var(--surface-2)] px-3 py-2.5">
                  {check.ok ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--mint)]" />
                  ) : (
                    <TriangleAlert
                      size={15}
                      className={`mt-0.5 shrink-0 ${check.critical ? 'text-[var(--coral)]' : 'text-[var(--gold)]'}`}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-[var(--text)]">{check.name}</p>
                    <p className="text-[11.5px] text-[var(--text-3)]">{check.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Run controls -------------------------------------------------------- */}
      <Card>
        <PanelHeader
          title="Run Auto Optimization"
          subtitle={`Searches ${label} configurations until a 4-hit validation result is found or the limit is reached`}
          right={<Wand2 size={16} className="text-[var(--gold)]" />}
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runAuto} loading={busy} disabled={isLive || preflight.data?.ready === false} size="lg">
              <Play size={15} /> Run Auto Optimization
            </Button>
            {isLive && job ? (
              <Button variant="secondary" onClick={cancel} loading={busy}>
                <Square size={14} /> Cancel run #{job.runId}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? 'Hide advanced options' : 'Advanced options'}
            </Button>
            <p className="text-[11.5px] text-[var(--text-3)]">
              Validation window is chosen automatically from the stored history.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Max configurations" hint="Hard stop — the search can never run indefinitely">
              <Select
                value={String(maxConfigurations)}
                onChange={(e) => setMaxConfigurations(Number(e.target.value))}
                disabled={isLive}
              >
                {MAX_CONFIGURATION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.toLocaleString('en-GB')}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex items-center gap-2 self-end pb-2.5 text-[12.5px] text-[var(--text-2)]">
              <input
                type="checkbox"
                checked={stopOnFourHit}
                onChange={(e) => setStopOnFourHit(e.target.checked)}
                disabled={isLive}
                className="h-4 w-4 accent-[var(--gold)]"
              />
              Stop when 4 hits found
            </label>
          </div>

          {advanced ? (
            <div className="grid gap-4 rounded-lg bg-[var(--surface-2)] p-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
                <input
                  type="checkbox"
                  checked={customWindow}
                  onChange={(e) => setCustomWindow(e.target.checked)}
                  disabled={isLive}
                  className="h-4 w-4 accent-[var(--gold)]"
                />
                Use custom validation dates
              </label>

              <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
                <input
                  type="checkbox"
                  checked={applyToModel}
                  onChange={(e) => setApplyToModel(e.target.checked)}
                  disabled={isLive}
                  className="h-4 w-4 accent-[var(--gold)]"
                />
                Apply the found configuration automatically when the run completes
              </label>

              {customWindow ? (
                <>
                  <Field label="Validation start">
                    <Input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      disabled={isLive}
                    />
                  </Field>
                  <Field
                    label="Validation end"
                    hint={`Must be before ${formatIsoDate(validationWindow?.latestDrawDate)}`}
                  >
                    <Input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      disabled={isLive}
                    />
                  </Field>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Live run detail ----------------------------------------------------- */}
      {job ? (
        <Card>
          <PanelHeader
            title={`Run #${job.runId} — ${label} model`}
            subtitle={
              job.validationStartDate && job.validationEndDate
                ? `Validation: ${formatIsoDate(job.validationStartDate)} → ${formatIsoDate(job.validationEndDate)}${
                    job.autoWindow ? ' (automatic)' : ' (custom)'
                  }`
                : undefined
            }
            right={<Badge tone={statusTone(job.status)}>{job.status}</Badge>}
          />

          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Started" value={<span className="text-[15px]">{formatDateTime(job.startedAt)}</span>} tone="violet" />
              <StatCard label="Configurations tested" value={job.configsTested} tone="violet" />
              <StatCard label="Configurations failed" value={job.configsFailed} tone="coral" />
              <StatCard label="Current best average" value={job.bestAvgHits != null ? job.bestAvgHits.toFixed(2) : '—'} tone="mint" />
            </div>

            {job.status === 'failed' ? (
              <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">
                <p className="font-medium">Optimization failed — no performance figures were produced.</p>
                <p className="mt-1">{job.errorMessage ?? 'The run stopped without a result.'}</p>
              </div>
            ) : null}

            {job.status === 'cancelled' ? (
              <div className="rounded-lg border border-[var(--line-2)] bg-[var(--surface-2)] px-4 py-3 text-[12.5px] text-[var(--text-2)]">
                Run cancelled after {job.configsTested} configuration(s). Nothing was applied.
              </div>
            ) : null}

            {job.status === 'completed' && !job.fourHitFound ? (
              <div className="rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3 text-[12.5px] text-[var(--text-2)]">
                No 4-hit configuration was found in this validation window. Best average hits:{' '}
                <span className="mono">{job.bestAvgHits != null ? job.bestAvgHits.toFixed(2) : '—'}</span>.{' '}
                {stopReasonText(job.stoppedReason, job)}
              </div>
            ) : null}

            {job.status === 'completed' ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={applyBest} loading={applying}>
                  {job.fourHitFound ? 'Use This Configuration For Predictions' : 'Use best configuration for predictions'}
                </Button>
                <p className="text-[11.5px] text-[var(--text-3)]">
                  Applying only creates a new active {label} model — the prediction algorithm itself is unchanged.
                </p>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* Pipeline diagnostic -------------------------------------------------- */}
      <Card>
        <PanelHeader
          title="Pipeline diagnostic"
          subtitle="Proves history → existing predictor → prediction → actual draw → existing scoring works (small sample)"
          right={<Activity size={16} className="text-[var(--sky)]" />}
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={runDiagnostic} loading={diagnosing}>
              Run diagnostic (10 draws)
            </Button>
            <p className="text-[11.5px] text-[var(--text-3)]">
              Uses the same automatic validation window and the default model configuration.
            </p>
          </div>

          {diagnosticError ? (
            <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12.5px] text-[#ffc0b8]">
              {diagnosticError}
            </div>
          ) : null}

          {diagnostic ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Validation draws" value={diagnostic.validationDrawCount} tone="sky" />
                <StatCard label="Predictions generated" value={diagnostic.predictionsGenerated} tone="mint" />
                <StatCard label="Predictions failed" value={diagnostic.predictionsFailed} tone="coral" />
                <StatCard label="Avg hits" value={diagnostic.avgHits.toFixed(2)} tone="gold" />
              </div>

              {diagnostic.structureIssues.length > 0 ? (
                <div className="rounded-lg border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-3 text-[12px] text-[#ffc0b8]">
                  <p className="font-medium">Structure issues detected</p>
                  <ul className="mt-1 list-disc pl-4">
                    {diagnostic.structureIssues.slice(0, 8).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--mint)]/40 bg-[var(--mint)]/10 px-4 py-3 text-[12.5px] text-[#9ff0d0]">
                  Prediction and actual-draw structures are valid and the recorded hit counts match a direct comparison.
                </div>
              )}

              {diagnostic.failures.length > 0 ? (
                <div className="rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3 text-[12px] text-[var(--text-2)]">
                  <p className="font-medium">Skipped evaluations</p>
                  <ul className="mt-1 list-disc pl-4">
                    {diagnostic.failures.slice(0, 8).map((failure) => (
                      <li key={failure.date}>
                        {formatIsoDate(failure.date)} — {failure.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Validation draw</th>
                      <th>Training draws</th>
                      <th>Predicted</th>
                      <th>Actual</th>
                      <th>Hits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnostic.rows.map((row) => (
                      <tr key={row.validationDrawDate}>
                        <td className="strong">{formatIsoDate(row.validationDrawDate)}</td>
                        <td className="mono">{row.trainingDrawCount}</td>
                        <td className="mono">{[...row.predictedMain, row.predictedBooster].join(' · ')}</td>
                        <td className="mono">{[...row.actualMain, row.actualBooster].join(' · ')}</td>
                        <td className="mono">{row.mainHits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* History -------------------------------------------------------------- */}
      <Card className="overflow-hidden">
        <PanelHeader
          title={`${label} optimization history`}
          subtitle={`${fourHitRuns.length} run${fourHitRuns.length === 1 ? '' : 's'} found a 4-hit configuration · failed runs are never counted as zero-performance`}
          right={<FlaskConical size={16} className="text-[var(--text-3)]" />}
        />
        {history.loading ? (
          <Spinner />
        ) : runs.length === 0 ? (
          <EmptyState title="No optimizer runs yet" description="Run auto optimization to search for a 4-hit configuration." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Configs tested</th>
                  <th>Stopped because</th>
                  <th>Validation window</th>
                  <th>Draws</th>
                  <th>4-hit</th>
                  <th>Best avg hits</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="strong">{formatDateTime(run.startedAt ?? run.completedAt)}</td>
                    <td>
                      <Badge tone={statusTone(run.status as OptimizerJobStatus)}>{run.status}</Badge>
                      {run.errorMessage && run.status === 'failed' ? (
                        <p className="mt-1 max-w-[240px] text-[11px] text-[var(--text-3)]">{run.errorMessage}</p>
                      ) : null}
                    </td>
                    <td className="mono">
                      {run.configsTested}
                      {run.maxConfigurations ? ` / ${run.maxConfigurations}` : ''}
                    </td>
                    <td className="text-[11.5px] text-[var(--text-3)]">
                      {run.stoppedReason === 'four-hit-found'
                        ? '4-hit found'
                        : run.stoppedReason === 'max-configurations-reached'
                          ? 'Max configs'
                          : run.stoppedReason === 'search-exhausted'
                            ? 'Search exhausted'
                            : '—'}
                    </td>
                    <td className="text-[11.5px]">
                      {formatIsoDate(run.validationPeriod.startDate)} → {formatIsoDate(run.validationPeriod.endDate)}
                    </td>
                    <td className="mono">{run.validationDrawCount ?? '—'}</td>
                    <td>
                      {run.fourHitFound ? (
                        <Badge tone="mint">
                          {run.fourHitHits ?? 4} hits · {formatIsoDate(run.fourHitDrawDate)}
                        </Badge>
                      ) : run.status === 'completed' ? (
                        <span className="text-[11.5px] text-[var(--text-3)]">none</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="mono">
                      {run.status === 'completed' && run.bestMetrics.avgHits != null
                        ? run.bestMetrics.avgHits.toFixed(2)
                        : '—'}
                    </td>
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
