---
description: Run the full Downbeat pipeline end to end — scan venues, match to taste, and build the Downbeat Radio show in Roon
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Bash(jq *), Read, Write, WebFetch, WebSearch
---

Run the whole Downbeat pipeline in one pass: scan the approved venue calendars, match upcoming
shows against the taste rubric, record the matches, and build the **Downbeat Radio** show into a
Roon zone. This is just the two existing skills chained — don't reinvent their logic; execute each
in full, in order.

## Steps

1. **Scan & match** — execute the `/scan-jazz` skill end to end (read its file at
   `.claude/commands/scan-jazz.md` and follow every step): read `data/venues.md` +
   `data/taste-rubric.md`, fetch each venue's calendar, classify and score against the rubric,
   dedup, and record each NEW match to the ledger with `seen:add`. Print its summary table.
   - If the rubric is still the placeholder, stop and tell the user to run `/build-rubric` first.

2. **Gate.** After the scan, check the ledger for shows with `date` >= today
   (`data/seen-events.json`). If there are **no upcoming matches at all**, stop here and report that
   there's nothing to build a show from yet — don't run an empty `/dj-show`. Otherwise continue.

3. **Build the show** — execute the `/dj-show` skill end to end (read its file at
   `.claude/commands/dj-show.md` and follow every step): curate ~4–6 acts from the upcoming
   matches, pick 2–3 canonical tracks each, resolve against Roon/Qobuz, write + synthesize the
   Stephen Holloway script (intro/outro/inter-act lead-ins for **Downbeat Radio**), build the
   manifest, and queue it into the Roon zone (paused by default). Newly-recorded matches from step 1
   are eligible here automatically since both read the same ledger.

4. **Report once, combined:** venues scanned (and any skipped/failed), matches recorded this run,
   the show's running order (clips + tracks, with any billed→played substitutions and dropped acts
   called out), the Roon zone, and anything `dj:queue` skipped. Remind the user they can press play
   or use Roon's **"Save Queue as Playlist"** to keep it.

## Notes
- This does **not** run `/sync-playlist` (the optional free Apple Music listen-ahead list) — the
  pipeline's output is the Downbeat Radio show. Run `/sync-playlist` separately if you want that.
- Prereqs are the union of both skills': `.env` with `LASTFM_API_KEY` + `ELEVENLABS_API_KEY`,
  Roon on the network with the **Downbeat DJ** extension enabled and `ROON_DJ_CLIPS_DIR` pointing
  at a Roon-watched folder, and `ffmpeg` installed. If a Roon prerequisite isn't met, step 1 still
  produces a useful scan — report what succeeded and what's needed to finish the show.
