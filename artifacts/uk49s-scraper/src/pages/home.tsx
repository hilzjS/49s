import { useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  CloudDownload,
  Database,
  FileJson,
  FileSpreadsheet,
  History,
  Info,
  LayoutDashboard,
  Menu,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
} from 'lucide-react';
import {
  getGetScraperHealthQueryKey,
  getScrapeAllYearQueryKey,
  getScrapeAllYearsQueryKey,
  getScrapeDrawTypeYearQueryKey,
  getScrapeLunchtimeYearQueryKey,
  getScrapeTeatimeYearQueryKey,
  scrapeAllYear,
  scrapeAllYears,
  scrapeDrawTypeYear,
  scrapeLunchtimeYear,
  scrapeTeatimeYear,
  useGetScraperHealth,
  useScrapeAllYear,
  useScrapeAllYears,
  useScrapeDrawTypeYear,
  useScrapeLunchtimeYear,
  useScrapeTeatimeYear,
} from '@workspace/api-client-react';
import type { DrawResult, ScrapeResponse, ScraperHealth } from '@workspace/api-client-react';

type DrawMode = 'lunchtime' | 'teatime' | 'both';
type RangeMode = 'single' | 'range' | 'all';

const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 1996 }, (_, index) => currentYear - index);

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function StatTile({ label, value, hint, accent = 'yellow' }: { label: string; value: string | number; hint: string; accent?: 'yellow' | 'coral' | 'blue' }) {
  return (
    <div className="stat-tile" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className={`stat-accent stat-accent-${accent}`} />
      <p className="eyebrow">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-hint">{hint}</p>
    </div>
  );
}

function Ball({ number, booster = false }: { number: number; booster?: boolean }) {
  return (
    <span className={`lottery-ball ${booster ? 'lottery-ball-booster' : ''}`} data-testid={`ball-${number}${booster ? '-booster' : ''}`}>
      {String(number).padStart(2, '0')}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="skeleton-list" aria-label="Loading results" data-testid="loading-results">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span /><span /><span /><span /><span /><span />
        </div>
      ))}
    </div>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <div className={`mobile-scrim ${open ? 'mobile-scrim-open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`app-sidebar ${open ? 'app-sidebar-open' : ''}`} aria-label="Primary navigation">
        <div className="brand-lockup">
          <div className="brand-mark"><span>49</span><i /></div>
          <div>
            <p className="brand-name">UK49s</p>
            <p className="brand-subtitle">HISTORY CONSOLE</p>
          </div>
          <button className="sidebar-close" onClick={onClose} aria-label="Close navigation" data-testid="button-close-navigation"><X size={18} /></button>
        </div>

        <div className="sidebar-rule" />
        <p className="sidebar-label">Workspace</p>
        <nav className="sidebar-nav">
          <button className="sidebar-item sidebar-item-active" data-testid="button-nav-console">
            <LayoutDashboard size={17} /><span>Scrape console</span><span className="nav-kicker">01</span>
          </button>
          <button className="sidebar-item" data-testid="button-nav-history">
            <History size={17} /><span>Run history</span><span className="nav-kicker">—</span>
          </button>
          <button className="sidebar-item" data-testid="button-nav-data">
            <Database size={17} /><span>Data quality</span><span className="nav-kicker">—</span>
          </button>
        </nav>

        <div className="sidebar-lower">
          <div className="sidebar-status">
            <div className="status-dot" />
            <div>
              <p>Scraper service</p>
              <small>Listening for work</small>
            </div>
          </div>
          <p className="sidebar-version">UK49S / CONSOLE 1.0.4</p>
        </div>
      </aside>
    </>
  );
}

function ScrapeForm({ onRun, running }: { onRun: (mode: DrawMode, range: RangeMode, year: number, endYear: number) => void; running: boolean }) {
  const [mode, setMode] = useState<DrawMode>('both');
  const [range, setRange] = useState<RangeMode>('single');
  const [year, setYear] = useState(currentYear - 1);
  const [endYear, setEndYear] = useState(currentYear);

  return (
    <section className="panel console-panel" data-testid="panel-scrape-console">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">01 / Configure collection</p>
          <h2>Set the draw window</h2>
        </div>
        <div className="heading-mark"><TerminalSquare size={19} /><span>GET /api/scrape</span></div>
      </div>
      <div className="form-block">
        <label className="field-label">Draw type</label>
        <div className="mode-grid" role="radiogroup" aria-label="Draw type">
          {([
            ['lunchtime', 'Lunch', '13:00 draw'],
            ['teatime', 'Tea', '18:45 draw'],
            ['both', 'Both', 'Complete day'],
          ] as const).map(([value, label, detail]) => (
            <button
              key={value}
              className={`mode-card ${mode === value ? 'mode-card-selected' : ''}`}
              onClick={() => setMode(value)}
              role="radio"
              aria-checked={mode === value}
              data-testid={`button-draw-type-${value}`}
            >
              <span className="mode-card-radio">{mode === value && <Check size={12} />}</span>
              <span className="mode-card-copy"><strong>{label}</strong><small>{detail}</small></span>
              <Clock3 size={16} className="mode-card-icon" />
            </button>
          ))}
        </div>
      </div>
      <div className="form-divider" />
      <div className="form-block">
        <label className="field-label">Collection window</label>
        <div className="range-tabs" role="radiogroup" aria-label="Collection window">
          {([
            ['single', 'One year'],
            ['range', 'Year range'],
            ['all', 'All available'],
          ] as const).map(([value, label]) => (
            <button key={value} className={`range-tab ${range === value ? 'range-tab-selected' : ''}`} onClick={() => setRange(value)} role="radio" aria-checked={range === value} data-testid={`button-range-${value}`}>
              {label}
            </button>
          ))}
        </div>
        {range === 'all' ? (
          <div className="all-years-note"><Info size={16} /><span>Will collect both draw types from 1997 through {currentYear}.</span></div>
        ) : (
          <div className="year-fields">
            <label className="select-wrap">
              <span>{range === 'range' ? 'From year' : 'Year'}</span>
              <select value={year} onChange={(event) => setYear(Number(event.target.value))} data-testid="select-start-year">
                {years.map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
              <ChevronDown size={15} />
            </label>
            {range === 'range' && (
              <label className="select-wrap">
                <span>Through</span>
                <select value={endYear} onChange={(event) => setEndYear(Number(event.target.value))} data-testid="select-end-year">
                  {years.filter((option) => option >= year).map((option) => <option value={option} key={option}>{option}</option>)}
                </select>
                <ChevronDown size={15} />
              </label>
            )}
          </div>
        )}
      </div>
      <div className="console-actions">
        <div className="request-summary">
          <span className="summary-dot" />
          <span>{range === 'all' ? 'Long-running collection' : `${mode === 'both' ? '2 draw types' : '1 draw type'} · ${range === 'range' ? `${year}–${endYear}` : year}`}</span>
        </div>
        <button className="run-button" onClick={() => onRun(mode, range, year, endYear)} disabled={running} data-testid="button-run-scrape">
          {running ? <RefreshCw size={17} className="spin" /> : <Play size={17} fill="currentColor" />}
          <span>{running ? 'Collecting…' : 'Run collection'}</span>
        </button>
      </div>
    </section>
  );
}

function HealthCard({ health, loading, error, onRetry }: { health?: ScraperHealth; loading: boolean; error: boolean; onRetry: () => void }) {
  return (
    <section className="panel health-panel" data-testid="panel-service-health">
      <div className="panel-heading compact-heading">
        <div><p className="eyebrow">Service health</p><h2>Collection engine</h2></div>
        <Server size={19} className="heading-icon" />
      </div>
      {loading ? (
        <div className="health-loading" data-testid="loading-health"><span /><span /><span /></div>
      ) : error ? (
        <div className="inline-error" data-testid="error-health"><AlertCircle size={18} /><span>Health endpoint unavailable.</span><button onClick={onRetry} data-testid="button-retry-health">Retry</button></div>
      ) : (
        <div className="health-body">
          <div className="health-status-row"><span className="health-pulse" /><strong data-testid="status-service-health">{health?.status === 'ok' ? 'Operational' : health?.status || 'Unknown'}</strong><span className="health-tag">LIVE</span></div>
          <dl className="health-grid">
            <div><dt>Service</dt><dd>{health?.service || 'UK49s scraper'}</dd></div>
            <div><dt>Cache entries</dt><dd>{health?.cacheEntries ?? '—'}</dd></div>
            <div className="health-wide"><dt>Last collection</dt><dd>{formatDate(health?.lastScrapeAt)}</dd></div>
          </dl>
        </div>
      )}
    </section>
  );
}

function ResultTable({ results, loading }: { results: DrawResult[]; loading: boolean }) {
  return (
    <section className="panel results-panel" data-testid="panel-result-preview">
      <div className="panel-heading results-heading">
        <div><p className="eyebrow">02 / Result preview</p><h2>Validated draw records</h2></div>
        <div className="table-tools">
          <span className="record-count" data-testid="text-result-count">{results.length} records</span>
          <button className="icon-button" aria-label="Search results" data-testid="button-search-results"><Search size={17} /></button>
        </div>
      </div>
      {loading ? <SkeletonRows /> : results.length === 0 ? (
        <div className="empty-state" data-testid="empty-results"><div className="empty-icon"><Database size={21} /></div><h3>No records loaded</h3><p>Choose a draw type and year, then run a collection to populate the preview.</p></div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Draw date</th><th>Type</th><th>Winning numbers</th><th>Booster</th><th>Validation</th></tr></thead>
            <tbody>
              {results.map((result, index) => (
                <tr key={`${result.draw_date}-${result.draw_type}-${index}`} data-testid={`row-result-${index}`}>
                  <td><span className="date-primary">{new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(result.draw_date))}</span><span className="date-secondary">{result.draw_date}</span></td>
                  <td><span className={`draw-pill draw-pill-${result.draw_type}`}>{result.draw_type === 'lunchtime' ? 'Lunch' : 'Tea'}</span></td>
                  <td><div className="balls-row">{result.winning_numbers.map((number) => <Ball key={number} number={number} />)}</div></td>
                  <td><Ball number={result.booster_ball} booster /></td>
                  <td><span className="valid-badge"><ShieldCheck size={14} /> Validated</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-footer"><span>Showing a preview of the latest accepted records</span><span className="mono-label">SCHEMA: DRAW_RESULT_V1</span></div>
    </section>
  );
}

function QualityPanel({ response }: { response: ScrapeResponse | null }) {
  const stats = response?.stats;
  const failed = stats?.failedUrls ?? [];
  const validation = stats?.validationErrors ?? [];
  return (
    <section className="panel quality-panel" data-testid="panel-run-quality">
      <div className="panel-heading compact-heading"><div><p className="eyebrow">Run quality</p><h2>Collection ledger</h2></div><BarChart3 size={19} className="heading-icon" /></div>
      {!response ? (
        <div className="quality-empty" data-testid="empty-quality"><Sparkles size={18} /><span>Quality metrics will appear after a run.</span></div>
      ) : (
        <div className="quality-body">
          <div className="quality-total"><span>Total accepted</span><strong data-testid="text-accepted-count">{stats?.recordsAccepted ?? response.count}</strong><small>{stats?.fromCache ? 'served from cache' : 'freshly collected'}</small></div>
          <div className="quality-metrics">
            <div><span>Discovered</span><strong>{stats?.recordsDiscovered ?? '—'}</strong></div>
            <div><span>Duplicates removed</span><strong>{stats?.duplicatesRemoved ?? '—'}</strong></div>
            <div><span>Rejected</span><strong className={stats?.recordsRejected ? 'metric-warn' : ''}>{stats?.recordsRejected ?? '—'}</strong></div>
            <div><span>Parse errors</span><strong className={stats?.parsingErrors ? 'metric-warn' : ''}>{stats?.parsingErrors ?? '—'}</strong></div>
          </div>
          <div className="issue-summary">
            <div className={failed.length ? 'issue-row issue-row-warn' : 'issue-row'}><AlertCircle size={15} /><span>Failed URLs</span><strong>{failed.length}</strong></div>
            <div className={validation.length ? 'issue-row issue-row-warn' : 'issue-row'}><ShieldCheck size={15} /><span>Validation errors</span><strong>{validation.length}</strong></div>
          </div>
          {(failed.length > 0 || validation.length > 0) && <div className="issue-details">{failed.slice(0, 2).map((item) => <p key={item}><span>URL</span>{item}</p>)}{validation.slice(0, 2).map((item) => <p key={item}><span>CHECK</span>{item}</p>)}</div>}
        </div>
      )}
    </section>
  );
}

function DownloadButtons({ results }: { results: DrawResult[] }) {
  const download = (format: 'json' | 'csv') => {
    const content = format === 'json'
      ? JSON.stringify(results, null, 2)
      : ['draw_date,draw_type,winning_numbers,booster_ball', ...results.map((result) => `${result.draw_date},${result.draw_type},"${result.winning_numbers.join(' ')}",${result.booster_ball}`)].join('\n');
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uk49s-results.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="download-actions">
      <span className="eyebrow">Export loaded data</span>
      <button onClick={() => download('json')} disabled={!results.length} data-testid="button-download-json"><FileJson size={16} /> JSON</button>
      <button onClick={() => download('csv')} disabled={!results.length} data-testid="button-download-csv"><FileSpreadsheet size={16} /> CSV</button>
      <button className="download-all" onClick={() => download('json')} disabled={!results.length} data-testid="button-download-all"><CloudDownload size={16} /> Download set</button>
    </div>
  );
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<ScrapeResponse | null>(null);
  const [results, setResults] = useState<DrawResult[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const health = useGetScraperHealth({ query: { queryKey: getGetScraperHealthQueryKey(), refetchInterval: 30000 } });
  const hookYear = currentYear - 1;
  useScrapeDrawTypeYear('lunchtime', hookYear, { forceRefresh: false }, { query: { enabled: false, queryKey: getScrapeDrawTypeYearQueryKey('lunchtime', hookYear, { forceRefresh: false }) } });
  useScrapeLunchtimeYear(hookYear, { forceRefresh: false }, { query: { enabled: false, queryKey: getScrapeLunchtimeYearQueryKey(hookYear, { forceRefresh: false }) } });
  useScrapeTeatimeYear(hookYear, { forceRefresh: false }, { query: { enabled: false, queryKey: getScrapeTeatimeYearQueryKey(hookYear, { forceRefresh: false }) } });
  useScrapeAllYear(hookYear, { forceRefresh: false }, { query: { enabled: false, queryKey: getScrapeAllYearQueryKey(hookYear, { forceRefresh: false }) } });
  useScrapeAllYears({ forceRefresh: false }, { query: { enabled: false, queryKey: getScrapeAllYearsQueryKey({ forceRefresh: false }) } });

  const runCollection = async (mode: DrawMode, range: RangeMode, year: number, endYear: number) => {
    setRunning(true);
    setRunError(null);
    try {
      let result: ScrapeResponse;
      if (range === 'all') {
        result = await scrapeAllYears({ forceRefresh: false });
      } else if (range === 'range') {
        const responses = await Promise.all(Array.from({ length: endYear - year + 1 }, (_, index) => {
          const targetYear = year + index;
          if (mode === 'lunchtime') return scrapeLunchtimeYear(targetYear, { forceRefresh: false });
          if (mode === 'teatime') return scrapeTeatimeYear(targetYear, { forceRefresh: false });
          return scrapeAllYear(targetYear, { forceRefresh: false });
        }));
        const first = responses[0];
        result = { ...first, year, count: responses.reduce((sum, item) => sum + item.count, 0), results: responses.flatMap((item) => item.results), stats: {
          ...first.stats,
          urlsRequested: responses.reduce((sum, item) => sum + item.stats.urlsRequested, 0),
          recordsDiscovered: responses.reduce((sum, item) => sum + item.stats.recordsDiscovered, 0),
          recordsAccepted: responses.reduce((sum, item) => sum + item.stats.recordsAccepted, 0),
          duplicatesRemoved: responses.reduce((sum, item) => sum + item.stats.duplicatesRemoved, 0),
          recordsRejected: responses.reduce((sum, item) => sum + item.stats.recordsRejected, 0),
          parsingErrors: responses.reduce((sum, item) => sum + item.stats.parsingErrors, 0),
          failedUrls: responses.flatMap((item) => item.stats.failedUrls),
          validationErrors: responses.flatMap((item) => item.stats.validationErrors ?? []),
        } };
      } else if (mode === 'lunchtime') {
        result = await scrapeLunchtimeYear(year, { forceRefresh: false });
      } else if (mode === 'teatime') {
        result = await scrapeTeatimeYear(year, { forceRefresh: false });
      } else {
        result = await scrapeAllYear(year, { forceRefresh: false });
      }
      setResponse(result);
      setResults(result.results);
      setLastRun(new Date().toISOString());
    } catch {
      setRunError('The collection could not be completed. Check the service and try again.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="console-app">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20} /></button>
          <div className="breadcrumb"><span className="breadcrumb-muted">Workspace</span><span>/</span><strong>Scrape console</strong></div>
          <div className="topbar-right"><span className="topbar-time"><Clock3 size={14} /> UTC · {new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date())}</span><div className="operator-avatar" title="Operator">OP</div></div>
        </header>
        <div className="content-wrap">
          <div className="page-intro">
            <div><div className="overline"><span className="overline-line" /> DATA COLLECTION / UK49S</div><h1>Historical results,<br /><em>without the guesswork.</em></h1><p>Run a controlled collection against the UK49s archive. Every accepted draw is checked, traceable, and ready for downstream systems.</p></div>
            <div className="intro-aside"><div className="archive-stamp"><span>ARCHIVE</span><strong>49</strong><small>DRAW RECORDS</small></div><div><span className="aside-label">Last run</span><strong data-testid="text-last-run">{lastRun ? formatDate(lastRun) : 'No run this session'}</strong></div></div>
          </div>
          <div className="stat-grid">
            <StatTile label="Available from" value="1997" hint="First indexed draw" accent="blue" />
            <StatTile label="Draws per day" value="02" hint="Lunch + Tea" accent="yellow" />
            <StatTile label="Number range" value="01—49" hint="Six + booster ball" accent="coral" />
            <StatTile label="Current status" value={health.data?.status === 'ok' ? 'Ready' : 'Checking'} hint={health.data?.lastScrapeAt ? `Updated ${formatDate(health.data.lastScrapeAt)}` : 'Polling service'} accent="yellow" />
          </div>
          {runError && <div className="run-error" role="alert" data-testid="error-scrape-run"><AlertCircle size={18} /><span>{runError}</span><button onClick={() => setRunError(null)} aria-label="Dismiss error" data-testid="button-dismiss-error"><X size={16} /></button></div>}
          <div className="workspace-grid">
            <div className="workspace-main"><ScrapeForm onRun={runCollection} running={running} /><ResultTable results={results} loading={running} /></div>
            <div className="workspace-side"><HealthCard health={health.data} loading={health.isLoading} error={health.isError} onRetry={() => health.refetch()} /><QualityPanel response={response} /></div>
          </div>
          <DownloadButtons results={results} />
          <footer className="page-footer"><span><ShieldCheck size={14} /> Records are validated against the UK49s draw schema before acceptance.</span><span className="footer-right">SOURCE: UK49S ARCHIVE <span className="footer-separator">·</span> BUILD 1.0.4</span></footer>
        </div>
      </main>
    </div>
  );
}