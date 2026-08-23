---
name: UK49s source format
description: Non-obvious HTML and date conventions used by the UK.LottoNumbers archive.
---

The UK.LottoNumbers archive uses table rows with dates such as “Thursday 31st December 2015” and seven list items, where the last item has a bonus-ball class.

**Why:** Numeric-only date parsing and generic fallback scanning can miss the archive or count each row twice.

**How to apply:** Preserve ordinal weekday-aware date parsing and use the line-based fallback only when row-level candidates are absent.