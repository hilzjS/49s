// Typed client for the existing 49S Predictor API (Express server, proxied
// under /api). This module only *consumes* the API — it contains no scraping,
// prediction or database logic.

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
    throw new Error(message);
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
  modelVersion: string | null;
  trainingCutoff: string;
  status: string;
  mainHits: number | null;
  boosterHit: boolean | null;
  actualMain: number[] | null;
  actualBooster: number | null;
  createdAt: string;
}

export interface ModelInfo {
  id: number;
  drawType: DrawType;
  version: string;
  status: string;
  weights: Record<string, number>;
  lookbackWindow: number;
  constraints: { enforceDiversity: boolean; minNumberSpread: number; maxSameGroup: number };
  trainingCutoff: string | null;
  validationMetrics: { fourHitRate: number; avgHits: number; sampleSize: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface BacktestRun {
  id: number;
  totalPredictions: number;
  testPeriod: { startDate: string; endDate: string };
  lookbackWindow: number;
  superhybrid: {
    hitDistribution: { hits: number; count: number }[];
    avgMainHits: number;
    medianMainHits: number;
    maxMainHits: number;
    fourHitCount: number;
    fourHitRate: number;
    boosterHitRate: number;
  };
  baselines: {
    random: { totalPredictions: number; avgMainHits: number; fourHitRate: number; boosterHitRate: number };
    frequency: { totalPredictions: number; avgMainHits: number; fourHitRate: number; boosterHitRate: number };
  };
  comparison: Record<string, { avgHitsDiff: number; fourHitRateDiff: number }>;
  rollingMetrics: unknown[];
  completedAt: string | null;
}

export interface BacktestHistoryItem {
  id: number;
  lookbackWindow: number;
  testPeriod: { startDate: string; endDate: string };
  totalPredictions: number;
  avgMainHits: number | null;
  fourHitRate: number | null;
  boosterHitRate: number | null;
  baselines: {
    random: { avgMainHits: number | null; fourHitRate: number | null };
    frequency: { avgMainHits: number | null; fourHitRate: number | null };
  };
  completedAt: string | null;
}

export interface OptimizerRunItem {
  id: number;
  status: string;
  configsTested: number;
  validationPeriod: { startDate: string | null; endDate: string | null };
  testPeriod: { startDate: string | null; endDate: string | null } | null;
  bestMetrics: { fourHitRate: number | null; avgHits: number | null };
  completedAt: string | null;
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
    get<{ success: boolean; count: number; predictions: Prediction[] }>(
      `/api/predictions/history/${drawType}?limit=${limit}`,
    ),
  getActiveModel: (drawType: DrawType) =>
    get<{ success: boolean; model: ModelInfo }>(`/api/predictions/model/${drawType}`),
  getModelHistory: (drawType: DrawType) =>
    get<{ success: boolean; count: number; models: ModelInfo[] }>(
      `/api/predictions/model/${drawType}/history`,
    ),

  getBacktestLatest: (drawType: DrawType) =>
    get<{ success: boolean; backtest: BacktestRun }>(`/api/backtest/latest/${drawType}`),
  getBacktestHistory: (drawType: DrawType) =>
    get<{ success: boolean; count: number; backtests: BacktestHistoryItem[] }>(
      `/api/backtest/history/${drawType}`,
    ),
  getOptimizerHistory: (drawType: DrawType) =>
    get<{ success: boolean; count: number; optimizationRuns: OptimizerRunItem[] }>(
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
  runBacktest: (body: Record<string, unknown>) =>
    adminPost<{ success: boolean; backtest: BacktestRun }>('/api/backtest/run', body),
  runOptimizer: (body: Record<string, unknown>) =>
    adminPost<{ success: boolean; optimizerRun: unknown; bestConfiguration: unknown; newModelId: number | null }>(
      '/api/optimizer/run',
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