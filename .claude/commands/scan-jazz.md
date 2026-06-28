---
description: Scan approved venues for upcoming shows that match your taste and record them to the ledger
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Read, WebFetch, WebSearch
---

Scan the approved jazz venues for upcoming shows, keep the ones that match the taste rubric,
and record each new match in the dedup ledger (`seen-events.json`) so `/dj-show` can build a
radio show from them. Auto-record (no confirmation gate).

## Steps

1. Read `data/venues.md` and `data/taste-rubric.md`.
   - If the rubric is still the placeholder (no real loved artists), stop and tell the user to
     run `/build-rubric` first.

2. For each venue that has a real `Calendar:` URL (skip any marked `<CONFIRM …>`), `WebFetch`
   the page and extract upcoming shows within the next ~60 days. For each show capture:
   `artist/band`, `date` (resolve to `YYYY-MM-DD`; today is the current date), `time`,
   `ticket/info URL`. If a page fails to load or has no parseable calendar, note it and move on.
   **Honor each venue's `Notes`** — e.g. multi-genre rooms like Blue Note (Hollywood) say to
   include jazz shows only, so drop non-jazz acts (rock, hip-hop, comedy, R&B, etc.) before scoring.

3. Determine each headliner's style/era using a **tiered approach** (don't research what you
   already know — keep scans cheap):
   1. **Name match first** — if the headliner is a Loved Artist or an obvious torchbearer of a
      Preferred Style, score immediately, no research.
   2. **Use the venue's own billing** — listings often state the style, sidemen, or "tribute
      to …"; that's frequently enough to classify.
   3. **Research only the unfamiliar** — when 1 and 2 leave the style/era genuinely unclear,
      do a lightweight lookup (WebSearch / AllMusic / Wikipedia / the artist's own bio) to pin
      down instrument, style, and era *before* scoring. This is also what makes the rationale
      honest rather than hand-wavy, and catches Avoids hiding behind generic names (e.g. a
      plain-named act that turns out to be a fusion or free-jazz project).

   Then score against the rubric's **Scoring Guidance** and keep only matches. For each kept
   show write a one-to-two sentence rationale ("why you'd like it") grounded in the rubric
   (loved artist, preferred style/era, notable collaborators). Drop anything that trips an
   **Avoid** signal, even if the artist name is loved. An artist who stays genuinely
   unclassifiable even after a quick lookup should be **included with a caveat** in the
   rationale (note the uncertainty) rather than silently dropped.

4. Dedup. For each match run:
   ```
   npm run downbeat -- seen:check --venue "<venue>" --date "<YYYY-MM-DD>" --artist "<artist>"
   ```
   Skip any that print `seen`.

5. For each NEW match, record it in the dedup ledger so `/dj-show` can pick it up later. Pass the
   show **time**, **ticket/info URL**, the **rationale** you wrote in step 3, and a **confidence**
   level — they enrich the published calendar (see step 6):
   ```
   npm run downbeat -- seen:add --venue "<Venue>" --date "<YYYY-MM-DD>" --artist "<Artist>" \
     --time "<7:30 PM or 19:30>" --url "<ticket/info link>" --description "<why-it-matches>" \
     --confidence "<strong|good|tentative>"
   ```
   `--confidence` maps to the rubric's scoring tiers. The calendar flags only the standouts (🎯
   strong) and close calls (🤔 tentative); a **good** match shows no emoji (being on the list is
   signal enough), so still record it as `good`:
   - **strong** — a Loved Artist, a direct loved-artist tie (e.g. a tribute or a known sideman of
     one), or a nationally-known torchbearer of a preferred style.
   - **good** — a solid preferred-style match (the default for most kept shows).
   - **tentative** — included with a caveat: style unconfirmed even after a quick look, or a
     permissive close-call (e.g. a free LACMA show).

   All flags are optional; include whatever the scan found. `seen:add` is a no-op on the
   `{venue, date, artist}` dedup key if already present, **but it will backfill** any of
   time/url/description/confidence that a prior entry was missing — so re-running a scan enriches
   old rows. `/dj-show` still re-derives its own commentary from the rubric; the description here is
   for the calendar.

6. **Refresh the calendar** from the ledger:
   ```
   npm run downbeat -- ics:build
   ```
   This (re)writes `docs/calendar.ics` and `docs/index.html` (upcoming shows). To publish the
   update, commit and push `docs/` — GitHub Pages serves it at
   `https://dansays.github.io/downbeat/calendar.ics` (subscribe via `webcal://…`).

7. Print a summary table: venues scanned (and any skipped/failed), shows found, matches kept
   (with rationale), matches recorded, and dupes skipped.
