import { logger } from "./logger";

export type DrawType = "lunchtime" | "teatime";
export type DrawResult = {
  draw_date: string;
  draw_type: DrawType;
  winning_numbers: number[];
  booster_ball: number;
};
export type ScrapeStats = {
  urlsRequested: number;
  recordsDiscovered: number;
  recordsAccepted: number;
  duplicatesRemoved: number;
  recordsRejected: number;
  parsingErrors: number;
  failedUrls: string[];
  validationErrors: string[];
  fromCache: boolean;
};
export type ScrapeResponse = {
  success: boolean;
  drawType: string;
  year: number;
  source: string;
  count: number;
  results: DrawResult[];
  stats: ScrapeStats;
};

const cache = new Map<string, { expiresAt: number; response: ScrapeResponse }>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 350;
let lastRequestAt = 0;
let lastScrapeAt: string | null = null;

export function getScraperHealth() {
  return {
    status: "ok",
    service: "uk49s-historical-results",
    cacheEntries: cache.size,
    lastScrapeAt,
  };
}

function sourceUrl(drawType: DrawType, year: number) {
  return `https://uk.lottonumbers.com/uk49s-${drawType}/results/${year}`;
}

function blankStats(): ScrapeStats {
  return {
    urlsRequested: 0,
    recordsDiscovered: 0,
    recordsAccepted: 0,
    duplicatesRemoved: 0,
    recordsRejected: 0,
    parsingErrors: 0,
    failedUrls: [],
    validationErrors: [],
    fromCache: false,
  };
}

function decodeHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(value: string, year: number) {
  const numeric = value.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (numeric) {
    const [, day, month, dateYear] = numeric;
    if (Number(dateYear) !== year) return null;
    const date = new Date(Date.UTC(Number(dateYear), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(dateYear) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day)
      ? `${dateYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
      : null;
  }
  const named = value.match(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b/i);
  if (!named) return null;
  const date = new Date(`${named[1]} ${named[2]} ${named[3]} UTC`);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() !== year
    ? null
    : date.toISOString().slice(0, 10);
}

function candidateTexts(html: string) {
  const candidates: string[] = [];
  const rowPattern = /<(tr|li|article|section|div)[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const text = decodeHtml(match[2]);
    if (/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}\b/i.test(text)) {
      candidates.push(text);
    }
  }
  // Fallback for markup that has no useful row wrappers: scan lines and table cells.
  if (candidates.length === 0) {
    for (const part of html.split(/[\r\n]+|<\/(?:td|th|p|br)>/i)) {
      const text = decodeHtml(part);
      if (/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}\b/i.test(text)) {
        candidates.push(text);
      }
    }
  }
  const unique = [...new Set(candidates)];
  return { texts: unique, exactDuplicates: candidates.length - unique.length };
}

export function parseRecords(html: string, drawType: DrawType, year: number, stats: ScrapeStats) {
  const results: DrawResult[] = [];
  const seen = new Set<string>();
  const { texts, exactDuplicates } = candidateTexts(html);
  stats.duplicatesRemoved += exactDuplicates;
  for (const text of texts) {
    const date = parseDate(text, year);
    if (!date) continue;
    stats.recordsDiscovered += 1;
    const withoutDate = text
      .replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b/g, " ")
      .replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}\b/gi, " ");
    const numbers = [...withoutDate.matchAll(/(?<!\d)(\d{1,2})(?!\d)/g)].map((m) => Number(m[1]));
    if (numbers.length < 7) {
      stats.recordsRejected += 1;
      stats.parsingErrors += 1;
      stats.validationErrors.push(`${date}: expected 7 numbers, found ${numbers.length}`);
      continue;
    }
    const drawNumbers = numbers.slice(0, 7);
    if (drawNumbers.some((number) => !Number.isInteger(number) || number < 1 || number > 49)) {
      stats.recordsRejected += 1;
      stats.validationErrors.push(`${date}: number outside 1-49`);
      continue;
    }
    const key = `${drawType}:${date}`;
    if (seen.has(key)) {
      stats.duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);
    results.push({
      draw_date: date,
      draw_type: drawType,
      winning_numbers: drawNumbers.slice(0, 6),
      booster_ball: drawNumbers[6],
    });
    stats.recordsAccepted += 1;
  }
  return results.sort((a, b) => a.draw_date.localeCompare(b.draw_date));
}

async function fetchHtml(url: string, stats: ScrapeStats) {
  stats.urlsRequested += 1;
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-GB,en;q=0.9",
          "user-agent": "Mozilla/5.0 (compatible; UK49sHistoricalResults/1.0)",
        },
        signal: AbortSignal.timeout(15_000),
      });
      logger.info({ url, status: response.status, attempt }, "Scraper requested URL");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      logger.warn({ url, attempt, err: error }, "Scraper request failed");
      if (attempt === attempts) {
        stats.failedUrls.push(url);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  return null;
}

export async function scrapeYear(drawType: DrawType, year: number, forceRefresh = false): Promise<ScrapeResponse> {
  const key = `${drawType}:${year}`;
  const cached = cache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return { ...cached.response, stats: { ...cached.response.stats, fromCache: true } };
  }
  const stats = blankStats();
  const url = sourceUrl(drawType, year);
  const html = await fetchHtml(url, stats);
  const results = html ? parseRecords(html, drawType, year, stats) : [];
  logger.info({ url, recordsDiscovered: stats.recordsDiscovered, recordsAccepted: stats.recordsAccepted, duplicates: stats.duplicatesRemoved, rejected: stats.recordsRejected }, "Scraper parsed URL");
  const response: ScrapeResponse = {
    success: stats.failedUrls.length === 0,
    drawType,
    year,
    source: url,
    count: results.length,
    results,
    stats,
  };
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, response });
  lastScrapeAt = new Date().toISOString();
  return response;
}

export async function scrapeAllYear(year: number, forceRefresh = false): Promise<ScrapeResponse> {
  const [lunch, tea] = await Promise.all([
    scrapeYear("lunchtime", year, forceRefresh),
    scrapeYear("teatime", year, forceRefresh),
  ]);
  const results = [...lunch.results, ...tea.results].sort((a, b) => a.draw_date.localeCompare(b.draw_date) || a.draw_type.localeCompare(b.draw_type));
  return {
    success: lunch.success && tea.success,
    drawType: "both",
    year,
    source: `${lunch.source},${tea.source}`,
    count: results.length,
    results,
    stats: {
      urlsRequested: lunch.stats.urlsRequested + tea.stats.urlsRequested,
      recordsDiscovered: lunch.stats.recordsDiscovered + tea.stats.recordsDiscovered,
      recordsAccepted: lunch.stats.recordsAccepted + tea.stats.recordsAccepted,
      duplicatesRemoved: lunch.stats.duplicatesRemoved + tea.stats.duplicatesRemoved,
      recordsRejected: lunch.stats.recordsRejected + tea.stats.recordsRejected,
      parsingErrors: lunch.stats.parsingErrors + tea.stats.parsingErrors,
      failedUrls: [...lunch.stats.failedUrls, ...tea.stats.failedUrls],
      validationErrors: [...lunch.stats.validationErrors, ...tea.stats.validationErrors],
      fromCache: lunch.stats.fromCache && tea.stats.fromCache,
    },
  };
}

export async function scrapeAll(forceRefresh = false): Promise<ScrapeResponse> {
  const currentYear = new Date().getUTCFullYear();
  const combined: ScrapeResponse = {
    success: true,
    drawType: "both",
    year: currentYear,
    source: "https://uk.lottonumbers.com",
    count: 0,
    results: [],
    stats: blankStats(),
  };
  for (let year = 1997; year <= currentYear; year += 1) {
    const response = await scrapeAllYear(year, forceRefresh);
    combined.success = combined.success && response.success;
    combined.results.push(...response.results);
    combined.stats.urlsRequested += response.stats.urlsRequested;
    combined.stats.recordsDiscovered += response.stats.recordsDiscovered;
    combined.stats.recordsAccepted += response.stats.recordsAccepted;
    combined.stats.duplicatesRemoved += response.stats.duplicatesRemoved;
    combined.stats.recordsRejected += response.stats.recordsRejected;
    combined.stats.parsingErrors += response.stats.parsingErrors;
    combined.stats.failedUrls.push(...response.stats.failedUrls);
    combined.stats.validationErrors.push(...response.stats.validationErrors);
  }
  combined.results.sort((a, b) => a.draw_date.localeCompare(b.draw_date) || a.draw_type.localeCompare(b.draw_type));
  combined.count = combined.results.length;
  return combined;
}