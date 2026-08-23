import assert from "node:assert/strict";
import test from "node:test";
import { parseRecords, type ScrapeStats } from "./uk49s-scraper";

function stats(): ScrapeStats {
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

test("2015 Lunchtime fixture parses complete rows and separates booster ball", () => {
  const html = `
    <h2>January 2015</h2>
    <table><tr><td>01/01/2015</td><td>01</td><td>07</td><td>13</td><td>25</td><td>36</td><td>49</td><td>08</td></tr>
    <tr><td>02/01/2015</td><td>02</td><td>08</td><td>14</td><td>26</td><td>37</td><td>48</td><td>09</td></tr></table>
    <h2>February 2015</h2>
    <div class="draw-result">01/02/2015 03 09 15 27 38 47 Booster 10</div>
  `;
  const result = parseRecords(html, "lunchtime", 2015, stats());
  assert.equal(result.length, 3);
  assert.deepEqual(result[0].winning_numbers, [1, 7, 13, 25, 36, 49]);
  assert.equal(result[0].booster_ball, 8);
  assert.equal(result[2].draw_date, "2015-02-01");
});

test("2015 Teatime fixture removes duplicate dates and rejects malformed rows", () => {
  const fixture = `
    <table>
      <tr><td>31-12-2015</td><td>04</td><td>11</td><td>19</td><td>22</td><td>33</td><td>41</td><td>06</td></tr>
      <tr><td>31-12-2015</td><td>04</td><td>11</td><td>19</td><td>22</td><td>33</td><td>41</td><td>06</td></tr>
      <tr><td>30-12-2015</td><td>04</td><td>11</td><td>19</td><td>22</td><td>33</td><td>60</td><td>06</td></tr>
    </table>`;
  const resultStats = stats();
  const result = parseRecords(fixture, "teatime", 2015, resultStats);
  assert.equal(result.length, 1);
  assert.equal(result[0].booster_ball, 6);
  assert.equal(resultStats.duplicatesRemoved, 1);
  assert.equal(resultStats.recordsRejected, 1);
});