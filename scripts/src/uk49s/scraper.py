"""Python scraper preserving existing TypeScript logic. 5 main + 1 booster."""
import re, time, datetime, requests
from typing import List, Dict, Optional, Tuple

SOURCE_BASE = "https://uk.lottonumbers.com"
MIN_REQUEST_GAP_MS = 350
RETRY_ATTEMPTS = 3
TIMEOUT_S = 15
_last_request_at = 0.0


def _throttle():
    global _last_request_at
    now = time.time() * 1000
    wait_ms = max(0, MIN_REQUEST_GAP_MS - (now - _last_request_at))
    if wait_ms > 0:
        time.sleep(wait_ms / 1000)
    _last_request_at = time.time() * 1000


def source_url(draw_type: str, year: int) -> str:
    return f"{SOURCE_BASE}/uk49s-{draw_type}/results/{year}"


def _decode_html(value: str) -> str:
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = value.replace("&nbsp;", " ").replace("&#39;", "'").replace("&amp;", "&")
    value = re.sub(r"&ndash;|&mdash;", "-", value)
    value = re.sub(r"<[^>]*>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


_DATE_NUMERIC = re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b")
_DATE_NAMED = re.compile(
    r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*"
    r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b",
    re.IGNORECASE,
)
_ROW = re.compile(r"<(tr|li|article|section|div)[^>]*>([\s\S]*?)</\1>", re.IGNORECASE)


def parse_date(value: str, year: int) -> Optional[str]:
    numeric = _DATE_NUMERIC.search(value)
    if numeric:
        d, m, y = int(numeric.group(1)), int(numeric.group(2)), int(numeric.group(3))
        if y != year:
            return None
        try:
            return datetime.date(y, m, d).isoformat()
        except ValueError:
            return None
    named = _DATE_NAMED.search(value)
    if named:
        try:
            date = datetime.date(
                int(named.group(3)),
                datetime.datetime.strptime(named.group(2)[:3], "%b").month,
                int(named.group(1)),
            )
        except ValueError:
            return None
        if date.year != year:
            return None
        return date.isoformat()
    return None


def _candidate_texts(html: str) -> List[str]:
    texts = []
    for match in _ROW.finditer(html):
        text = _decode_html(match.group(2))
        if _DATE_NUMERIC.search(text) or _DATE_NAMED.search(text):
            texts.append(text)
    if not texts:
        for part in re.split(r"[\r\n]+|</(?:td|th|p|br)>", html, flags=re.IGNORECASE):
            text = _decode_html(part)
            if _DATE_NUMERIC.search(text) or _DATE_NAMED.search(text):
                texts.append(text)
    return list(dict.fromkeys(texts))


def parse_records(html: str, draw_type: str, year: int) -> Tuple[List[Dict], Dict]:
    stats = {
        "urlsRequested": 0, "recordsDiscovered": 0, "recordsAccepted": 0,
        "duplicatesRemoved": 0, "recordsRejected": 0, "parsingErrors": 0,
        "failedUrls": [], "validationErrors": [],
    }
    results: List[Dict] = []
    seen = set()
    for text in _candidate_texts(html):
        date = parse_date(text, year)
        if not date:
            continue
        stats["recordsDiscovered"] += 1
        cleaned = _DATE_NUMERIC.sub(" ", text)
        cleaned = _DATE_NAMED.sub(" ", cleaned)
        numbers = [int(m.group(1)) for m in re.finditer(r"(?<!\d)(\d{1,2})(?!\d)", cleaned)]
        if len(numbers) < 7:
            stats["recordsRejected"] += 1
            stats["parsingErrors"] += 1
            stats["validationErrors"].append(f"{date}: expected 7 numbers, found {len(numbers)}")
            continue
        draw_numbers = numbers[:6]
        if any(n < 1 or n > 49 for n in draw_numbers):
            stats["recordsRejected"] += 1
            stats["validationErrors"].append(f"{date}: number outside 1-49")
            continue
        main_numbers = sorted(draw_numbers[:5])
        booster_ball = draw_numbers[5]
        key = f"{draw_type}:{date}"
        if key in seen:
            stats["duplicatesRemoved"] += 1
            continue
        seen.add(key)
        results.append({
            "draw_date": date,
            "draw_type": draw_type,
            "winning_numbers": main_numbers,
            "booster_ball": booster_ball,
        })
        stats["recordsAccepted"] += 1
    results.sort(key=lambda r: r["draw_date"])
    return results, stats


def fetch_html(url: str, stats: Dict) -> Optional[str]:
    stats["urlsRequested"] += 1
    headers = {
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-GB,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; UK49sHistoricalResults/1.0)",
    }
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            _throttle()
            resp = requests.get(url, headers=headers, timeout=TIMEOUT_S)
            if resp.status_code == 200:
                return resp.text
            raise RuntimeError(f"HTTP {resp.status_code}")
        except Exception:
            if attempt == RETRY_ATTEMPTS:
                stats["failedUrls"].append(url)
                return None
            time.sleep(attempt * 0.5)
    return None


def scrape_year(draw_type: str, year: int) -> Dict:
    url = source_url(draw_type, year)
    stats = {
        "urlsRequested": 0, "recordsDiscovered": 0, "recordsAccepted": 0,
        "duplicatesRemoved": 0, "recordsRejected": 0, "parsingErrors": 0,
        "failedUrls": [], "validationErrors": [],
    }
    html = fetch_html(url, stats)
    results, ps = parse_records(html or "", draw_type, year)
    for k in [
        "recordsDiscovered", "recordsAccepted", "duplicatesRemoved",
        "recordsRejected", "parsingErrors", "failedUrls", "validationErrors",
    ]:
        if isinstance(stats[k], list):
            stats[k].extend(ps[k])
        else:
            stats[k] += ps[k]
    return {
        "success": len(stats["failedUrls"]) == 0,
        "drawType": draw_type,
        "year": year,
        "source": url,
        "count": len(results),
        "results": results,
        "stats": stats,
    }
