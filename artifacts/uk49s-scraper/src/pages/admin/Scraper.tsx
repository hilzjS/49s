import { useMemo, useState } from 'react';
import { Database, Download, KeyRound, Play, RefreshCw, Upload } from 'lucide-react';
import { api, getAdminKey, setAdminKey } from '@/lib/api';
import { useAsync, formatDateTime } from '@/lib/useAsync';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PanelHeader,
  Spinner,
  StatCard,
} from '@/components/ui';

export default function AdminScraper() {
  const [adminKey, setAdminKeyState] = useState(getAdminKey());
  const [startYear, setStartYear] = useState(2015);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const [singleYear, setSingleYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const health = useAsync(() => api.getScraperHealth(), []);
  const summary = useAsync(() => api.getDataSummary(), []);
  const runs = useAsync(() => api.getScrapeRuns(undefined, 100), []);

  const totals = useMemo(() => {
    const list = runs.data?.scrapeRuns ?? [];
    return {
      accepted: list.reduce((sum, run) => sum + run.recordsAccepted, 0),
      duplicates: list.reduce((sum, run) => sum + run.duplicatesRemoved, 0),
      rejected: list.reduce((sum, run) => sum + run.recordsRejected, 0),
      errors: list.reduce((sum, run) => sum + run.parsingErrors, 0),
    };
  }, [runs.data]);

  const lastSuccess = useMemo(() => {
    const list = (runs.data?.scrapeRuns ?? []).filter((run) => run.success);
    return list[0] ?? null;
  }, [runs.data]);

  function saveKey() {
    setAdminKey(adminKey.trim());
    setMessage('Admin key saved to this browser.');
  }

  async function runIngest(label: string, body: Parameters<typeof api.ingest>[0]) {
    setBusy(label);
    setMessage(null);
    setError(null);
    try {
      const result = await api.ingest(body);
      setMessage(`${label} completed: ${JSON.stringify(result).slice(0, 400)}`);
      summary.reload();
      runs.reload();
      health.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em]">Scraper</h1>
        <p className="mt-1 text-[13px] text-[var(--text-3)]">
          The scraper itself is unchanged — these controls call the existing ingestion endpoints.
        </p>
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
          title="Admin key"
          subtitle="Write endpoints require the server-side ADMIN_API_KEY"
          right={<KeyRound size={16} className="text-[var(--text-3)]" />}
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-[260px] flex-1">
            <Field label="ADMIN_API_KEY" hint="Stored locally in this browser only.">
              <Input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKeyState(e.target.value)}
                placeholder="Paste the admin key"
              />
            </Field>
          </div>
          <Button variant="secondary" onClick={saveKey}>
            Save key
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Imported" value={totals.accepted} hint="Across recent runs" icon={<Upload size={17} />} tone="mint" />
        <StatCard label="Duplicates skipped" value={totals.duplicates} hint="Duplicate prevention" icon={<RefreshCw size={17} />} tone="sky" />
        <StatCard label="Rejected" value={totals.rejected} hint="Failed validation" icon={<Database size={17} />} tone="coral" />
        <StatCard label="Parse errors" value={totals.errors} hint="Malformed pages" icon={<Download size={17} />} tone="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <PanelHeader
            title="Ingestion controls"
            subtitle="Populate history or refresh the latest draws"
            right={<Play size={16} className="text-[var(--text-3)]" />}
          />
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Start year">
                <Input
                  type="number"
                  min={1997}
                  max={new Date().getFullYear()}
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value))}
                />
              </Field>
              <Field label="End year">
                <Input
                  type="number"
                  min={1997}
                  max={new Date().getFullYear()}
                  value={endYear}
                  onChange={(e) => setEndYear(Number(e.target.value))}
                />
              </Field>
              <Button
                onClick={() => runIngest('Populate full history', { startYear, endYear, drawType: 'both' })}
                loading={busy === 'Populate full history'}
              >
                <Upload size={15} /> Populate Full History
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-5">
              <Field label="Single year">
                <Input
                  type="number"
                  min={1997}
                  max={new Date().getFullYear()}
                  value={singleYear}
                  onChange={(e) => setSingleYear(Number(e.target.value))}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() => runIngest(`Ingest ${singleYear}`, { year: singleYear, drawType: 'both' })}
                loading={busy === `Ingest ${singleYear}`}
              >
                Ingest year
              </Button>
              <Button
                variant="secondary"
                onClick={() => runIngest('Update latest', { drawType: 'latest' })}
                loading={busy === 'Update latest'}
              >
                <RefreshCw size={15} /> Update latest draws
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <PanelHeader title="Coverage" subtitle="Validated draws" />
          <div className="space-y-4 p-5">
            <div>
              <p className="eyebrow">Last successful scrape</p>
              <p className="mt-1.5 text-[13px] text-[var(--text)]">
                {lastSuccess ? formatDateTime(lastSuccess.completedAt) : '—'}
              </p>
              {lastSuccess ? (
                <p className="mt-1 text-[11.5px] text-[var(--text-3)]">
                  {lastSuccess.drawType} · {lastSuccess.year} · {lastSuccess.recordsAccepted} accepted
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="eyebrow">Lunchtime</p>
                <p className="stat-value-sm mt-1">{summary.data?.totalLunchDraws ?? 0}</p>
              </div>
              <div>
                <p className="eyebrow">Teatime</p>
                <p className="stat-value-sm mt-1">{summary.data?.totalTeaDraws ?? 0}</p>
              </div>
            </div>
            <div>
              <p className="eyebrow">Cache entries</p>
              <p className="mono mt-1.5 text-[13px] text-[var(--text)]">{health.data?.cacheEntries ?? 0}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <PanelHeader title="Scrape runs" subtitle="Most recent first" right={<Download size={16} className="text-[var(--text-3)]" />} />
        {runs.loading ? (
          <Spinner />
        ) : runs.error ? (
          <ErrorState message={runs.error} onRetry={runs.reload} />
        ) : !runs.data?.scrapeRuns?.length ? (
          <EmptyState icon={<Download size={20} />} title="No scrape runs yet" description="Run an ingestion to see run history here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Completed</th>
                  <th>Session</th>
                  <th>Year</th>
                  <th>Discovered</th>
                  <th>Accepted</th>
                  <th>Dupes</th>
                  <th>Rejected</th>
                  <th>Errors</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.scrapeRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="strong">{formatDateTime(run.completedAt)}</td>
                    <td>{run.drawType}</td>
                    <td className="mono">{run.year}</td>
                    <td className="mono">{run.recordsDiscovered}</td>
                    <td className="mono">{run.recordsAccepted}</td>
                    <td className="mono">{run.duplicatesRemoved}</td>
                    <td className="mono">{run.recordsRejected}</td>
                    <td className="mono">{run.parsingErrors}</td>
                    <td>
                      <Badge tone={run.success ? 'mint' : 'coral'}>{run.success ? 'success' : 'failed'}</Badge>
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