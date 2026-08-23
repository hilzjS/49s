# UK49s Historical Results

Standalone historical-results API for the UK49s Lunchtime and Teatime draws. It
does not contain prediction, AI, optimization, or backtesting logic.

## API

All endpoints are served below `/api`.

```bash
# Health
curl http://localhost:5000/api/health

# One draw type and year
curl http://localhost:5000/api/scrape/lunchtime/2015
curl http://localhost:5000/api/scrape/teatime/2015
curl "http://localhost:5000/api/scrape/lunchtime/2015?forceRefresh=true"

# Both draw types for one year
curl http://localhost:5000/api/scrape/all/2015

# Every year from 1997 through the current year
curl http://localhost:5000/api/scrape/all
```

The response shape is:

```json
{
  "success": true,
  "drawType": "lunchtime",
  "year": 2015,
  "source": "https://uk.lottonumbers.com/uk49s-lunchtime/results/2015",
  "count": 312,
  "results": [
    {
      "draw_date": "2015-01-01",
      "draw_type": "lunchtime",
      "winning_numbers": [1, 7, 13, 25, 36, 49],
      "booster_ball": 8
    }
  ],
  "stats": {
    "urlsRequested": 1,
    "recordsDiscovered": 312,
    "recordsAccepted": 312,
    "duplicatesRemoved": 0,
    "recordsRejected": 0,
    "parsingErrors": 0,
    "failedUrls": [],
    "validationErrors": [],
    "fromCache": false
  }
}
```

Results are validated to contain exactly six main numbers plus one Booster Ball,
all integers from 1 through 49. Records are normalized to ISO dates, deduped
by draw type and date, and sorted chronologically. Requests use browser-like
headers, a timeout, retries, rate limiting, structured logging, and a
15-minute in-memory cache.