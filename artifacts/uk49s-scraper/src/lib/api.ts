// Typed client for the 49S Predictor API (Express server, proxied under /api).
// This module only *consumes* the API — it contains no scraping, prediction or
// database logic.

export type DrawType = 'lunchtime' | 'teatime';

const ADMIN_KEY_STORAGE = '49s_admin_key';

export function getAdminKey(): string {
  try {
    return localStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setAdminKey(key: string): void {
  try {
    if (key) localStorage.setItem(ADMIN_KEY_STORAGE, key);
    else localStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    // ignore storage errors
  }
}

/** Error carrying the HTTP status so callers can distinguish "not yet
 *  generated" (404) from a genuine failure. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

function get<T>(path: string): Promise<T> {
  return request<T>(path);
}

function adminPost<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getAdminKey();
  if (key) headers['x-admin-key'] = key;
  return request<T>(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrawSummary {
  drawType: DrawType;
  totalDraws: number;
  earliestDate: string | null;
  latestDate: string | null;
  yearCounts: { year: number; count: number }[];
  missingDates: string[];
  duplicateCount: number;
  validationErrors: number;
}

export interface DataSummary {
  success: boolean;
  lunchtime: DrawSummary;
  teatime: DrawSummary;
  totalLunchDraws: number;
  totalTeaDraws: number;
}

export interface Draw {
  drawDate: string;
  drawType?: DrawType;
  mainNumbers: number[];
  boosterBall: number;
  validationStatus?: string;
  sourceUrl?: string | null;
}

export interface DrawsResponse {
  success: boolean;
  drawType: DrawType;
  count: number;
  draws: Draw[];
}

export interface Prediction {
  id: number;
  drawType: DrawType;
  predictionDate: string;
  predictedMain: number[];
  predictedBooster: number;
  modelConfigId: number | null;
  trainingCutoff: string;
  status: string;
  mainHits: number | null;
  boosterHit: boolean | null;
  actualMain: number[] | null;
  actualBooster: number | null;
  createdAt: string;
}

/** The engine's four tunable weights. */
export interface EngineWeights {
  hot: number;
  overdue: number;
  halfLife: number;
  power: number;
}

export interface ModelInfo {
  /** null when no champion has been locked yet (engine defaults are used). */
  id: number | null;
  drawType: DrawType | null;
  version: string;
  weights: EngineWeights;
  threePlusCount: number | null;
  avgHitsPerLine: number | null;
  candidatesTested: number | null;
  targetMet: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BacktestRun {
  id?: number;
  /** A valid run completed and resolved at least one draw. */
  valid?: boolean;
  /** Statistics are only counted since the active model was applied. */
  statsSince?: string | null;
  totalPredictions: number;
  testPeriod: { startDate: string; endDate: string };
  hitDistribution: { hits: number; lines: number; pct: number }[];
  avgHits: number;
  bestHits: number;
  fourHitRate: number;
  randomBaseline: number;
  completedAt?: string | null;
}

export interface BacktestHistoryItem {
  id: number;
  /** False for zero-draw/failed runs kept only for audit. */
  valid?: boolean;
  testPeriod: { startDate: string; endDate: string };
  totalPredictions: number;
  avgHits: number | null;
  bestHits: number | null;
  fourHitRate: number | null;
  randomBaseline: number | null;
  completedAt: string | null;
}

export interface OptimizerRunItem {
  id: number;
  drawType?: DrawType;
  status: string;
  candidatesTested: number;
  candidatesTotal: number;
  threePlusCount: number;
  targetMet: boolean;
  avgHitsPerLine: number | null;
  maxHits?: number | null;
  stoppedReason?: string | null;
  validationPeriod: { startDate: string | null; endDate: string | null };
  errorMessage?: string | null;
  startedAt?: string;
  completedAt: string | null;
}

export interface OptimizerWindow {
  drawType: DrawType;
  earliestDrawDate: string;
  latestDrawDate: string;
  referenceDrawDate: string;
  totalDraws: number;
  trainingDrawsBeforeWindow: number;
  validationStartDate: string;
  validationEndDate: string;
  validationDrawCount: number;
  monthsCovered: number;
  usedLargestAvailableWindow: boolean;
}

export interface OptimizerPreflightCheck {
  name: string;
  ok: boolean;
  critical: boolean;
  detail: string;
}

export type OptimizerJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface OptimizerJobState {
  runId: number;
  drawType: DrawType;
  status: OptimizerJobStatus;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  candidatesTested: number;
  candidatesTotal: number;
  threePlusCount: number;
  avgHitsPerLine: number | null;
  targetMet: boolean;
  weights: EngineWeights | null;
  errorMessage: string | null;
  hasResult: boolean;
}

export interface OptimizerPreflightResponse {
  success: boolean;
  drawType: DrawType;
  ready: boolean;
  window: OptimizerWindow;
  checks: OptimizerPreflightCheck[];
  candidates: number;
  target: number;
  activeJob: OptimizerJobState | null;
}

export interface OptimizerDiagnosticRow {
  validationDrawDate: string;
  drawType: DrawType;
  trainingDrawCount: number;
  trainingCutoff: string;
  predictedMain: number[];
  predictedBooster: number;
  actualMain: number[];
  actualBooster: number;
  mainHits: number;
  boosterHit: boolean;
}

export interface OptimizerDiagnosticReport {
  drawType: DrawType;
  window: OptimizerWindow;
  weights: EngineWeights;
  sampleRequested: number;
  validationDrawCount: number;
  predictionsGenerated: number;
  predictionsFailed: number;
  failures: { date: string; reason: string }[];
  structureIssues: string[];
  avgHits: number;
  fourHitRate: number;
  boosterHitRate: number;
  rows: OptimizerDiagnosticRow[];
}

export interface ScrapeRun {
  id: number;
  drawType: DrawType;
  year: number;
  sourceUrl: string | null;
  urlsRequested: number;
  recordsDiscovered: number;
  recordsAccepted: number;
  duplicatesRemoved: number;
  recordsRejected: number;
  parsingErrors: number;
  failedUrls: string[] | null;
  validationErrors: string[] | null;
  success: boolean;
  fromCache: boolean;
  startedAt: string;
  completedAt: string | null;
}

export interface ScraperHealth {
  status: string;
  service: string;
  cacheEntries: number;
  lastScrapeAt: string | null;
}

export interface IngestionResult {
  success: boolean;
  lunchtime: { imported: number; skipped: number; rejected: number; success: boolean };
  teatime: { imported: number; skipped: number; rejected: number; success: boolean };
  totalImported: number;
  totalSkipped: number;
  totalRejected: number;
}

// ---------------------------------------------------------------------------
// Read endpoints (public)
// ---------------------------------------------------------------------------

export const api = {
  getDataSummary: () => get<DataSummary>('/api/data/summary'),
  getLatestDraws: (drawType: DrawType, limit = 12) =>
    get<DrawsResponse>(`/api/data/latest/${drawType}?limit=${limit}`),
  getScrapeRuns: (drawType?: DrawType, limit = 50) =>
    get<{ success: boolean; count: number; scrapeRuns: ScrapeRun[] }>(
      `/api/data/scrape-runs?limit=${limit}${drawType ? `&drawType=${drawType}` : ''}`,
    ),
  getScraperHealth: () => get<ScraperHealth>('/api/health'),

  getLatestPrediction: (drawType: DrawType) =>
    get<{ success: boolean; prediction: Prediction }>(`/api/predictions/latest/${drawType}`),
  getPredictionHistory: (drawType: DrawType, limit = 50) =>
    get<{ success: boolean; count: number; statsSince?: string | null; predictions: Prediction[] }>(
      `/api/predictions/history/${drawType}?limit=${limit}`,
    ),
  getActiveModel: (drawType: DrawType) =>
    get<{ success: boolean; model: ModelInfo }>(`/api/predictions/model/${drawType}`),
  getModelHistory: (drawType: DrawType) =>
    get<{ success: boolean; count: number; models: ModelInfo[] }>(
      `/api/predictions/model/${drawType}/history`,
    ),

  getBacktestLatest: (drawType: DrawType) =>
    get<{ success: boolean; statsSince?: string | null; backtest: BacktestRun }>(
      `/api/backtest/latest/${drawType}`,
    ),
  getBacktestHistory: (drawType: DrawType) =>
    get<{ success: boolean; count: number; statsSince?: string | null; backtests: BacktestHistoryItem[] }>(
      `/api/backtest/history/${drawType}`,
    ),
  getOptimizerHistory: (drawType: DrawType) =>
    get<{ success: boolean; count: number; target: number; candidates: number; optimizationRuns: OptimizerRunItem[] }>(
      `/api/optimizer/history/${drawType}`,
    ),

  // -------------------------------------------------------------------------
  // Admin write endpoints (require the server-side ADMIN_API_KEY)
  // -------------------------------------------------------------------------
  ingest: (body: {
    drawType?: DrawType | 'both' | 'latest';
    year?: number;
    startYear?: number;
    endYear?: number;
    forceRefresh?: boolean;
  }) => adminPost<Record<string, unknown>>('/api/data/ingest', body),
  getDataQuality: () => get<{ success: boolean } & Record<string, unknown>>('/api/data/quality'),
  generatePrediction: (body: { drawType: DrawType; predictionDate?: string }) =>
    adminPost<{ success: boolean; prediction: Prediction }>('/api/predictions/generate', body),
  runBacktest: (body: {
    drawType: DrawType;
    testStartDate: string;
    testEndDate: string;
    weights?: EngineWeights;
  }) => adminPost<{ success: boolean; backtest: BacktestRun }>('/api/backtest/run', body),

  // Optimizer workflow (validation window, walk-forward tuning)
  getOptimizerPreflight: (drawType: DrawType) =>
    get<OptimizerPreflightResponse>(`/api/optimizer/preflight/${drawType}`),
  startOptimizerRun: (body: {
    drawType: DrawType;
    maxTests?: number;
    allowDuplicate?: boolean;
  }) =>
    adminPost<{
      success: boolean;
      runId: number;
      window: OptimizerWindow;
      job: OptimizerJobState;
    }>('/api/optimizer/run', body),
  getOptimizerStatus: (runId: number) =>
    get<{ success: boolean; source: string; job: OptimizerJobState }>(`/api/optimizer/status/${runId}`),
  getActiveOptimizerJob: (drawType: DrawType) =>
    get<{ success: boolean; drawType: DrawType; job: OptimizerJobState | null }>(
      `/api/optimizer/active/${drawType}`,
    ),
  cancelOptimizerRun: (runId: number) =>
    adminPost<{ success: boolean; job: OptimizerJobState }>(`/api/optimizer/cancel/${runId}`, {}),
  runOptimizerDiagnostic: (body: { drawType: DrawType; sampleSize?: number }) =>
    adminPost<{ success: boolean; drawType: DrawType; report: OptimizerDiagnosticReport }>(
      '/api/optimizer/diagnose',
      body,
    ),
};

export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
