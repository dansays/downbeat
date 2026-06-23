---
description: Scan approved venues for upcoming shows that match your taste and file Todoist tasks
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Read, WebFetch, WebSearch
---

Scan the approved jazz venues for upcoming shows, keep the ones that match the taste rubric,
and create a "review" task in Todoist for each new match. Auto-create tasks (no confirmation gate).

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

5. For each NEW match, get artist links:
   ```
   npm run downbeat -- links --artist "<artist>"
   ```
   Then create the tasks. **Write the JSON to a temp file with the Write tool** (do NOT
   `echo` it — the shell mangles `\n` escapes inside the description), then pipe the file in.
   Batch all matches into one array. Each item:
   ```json
   [{
     "content": "Review: <Artist> @ <Venue> — <Mon D>",
     "description": "<why you'd like it>\n\nApple Music: <appleMusic>\nAllMusic: <allMusic>\nTickets: <ticketUrl>\nVenue: <Venue>",
     "due_date": "<YYYY-MM-DD>",
     "venue": "<Venue>", "date": "<YYYY-MM-DD>", "artist": "<Artist>"
   }]
   ```
   Then:
   ```
   npm run downbeat -- todoist:add < /tmp/downbeat-tasks.json
   ```
   `todoist:add` resolves the project and records the dedup ledger automatically when
   `venue`/`date`/`artist` are included. (Requires `TODOIST_TOKEN` in `.env`.)

6. Print a summary table: venues scanned (and any skipped/failed), shows found, matches kept,
   tasks created, and dupes skipped.
