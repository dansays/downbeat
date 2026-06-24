---
description: Queue a curated jazz show of upcoming matched artists into a Roon zone (music-only; DJ commentary lands in Phase 2)
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Read, Write
---

Queue a curated **Roon** show of real recordings from the jazz artists who matched the taste
rubric and have an UPCOMING LA show. Built from `seen-events.json`, curated with Last.fm + the
rubric, resolved against the Roon/Qobuz library, and loaded **in order into a Roon zone's play
queue** (first track plays now, the rest follow).

> **Why a queue, not a saved playlist:** a Phase-0 spike found Roon's community API exposes only
> transport actions (Play/Queue) on tracks — it cannot create or edit a saved playlist. Queueing
> to a zone is how we assemble the show.

> **This phase is music-only.** The DJ persona (Stephen Holloway) and ElevenLabs-voiced commentary
> are Phase 2 — not generated here. Don't write or synthesize DJ patter.

## Prerequisites
- Roon is running on the same network, with the **Downbeat DJ** extension enabled (Roon →
  Settings → Extensions). The first run prints how to enable it if it isn't paired yet.
- `.env` has `LASTFM_API_KEY` (track popularity). Optionally set `ROON_ZONE` to your preferred
  zone (else pass `--zone`, or it auto-picks when the Core has a single zone). List zones with
  `npm run downbeat -- roon:zones`.

## Steps

1. Read `data/seen-events.json` (the ledger of matched shows) and `data/taste-rubric.md`. Keep only
   shows with `date` >= today.

2. **Normalize each billed name to a real recording artist** — same rules as `/sync-playlist`:
   - Strip ensemble suffixes: "The Amanda Castro Band" → "Amanda Castro"; "Yotam Silberstein
     Trio" → "Yotam Silberstein".
   - For tributes / "Music of X", use the **honored** artist: "Jaz Sawyer Quartet: Music of
     Coltrane" → "John Coltrane".
   - Drop names that don't map to a real recording artist and report them as skipped.

3. **Curate ~2–4 tracks per artist.** For each artist, run
   `npm run downbeat -- lastfm:top --artist "<name>" --limit 8` to get popular tracks, then pick
   the 2–4 best **using the rubric**: prefer styles/eras the rubric loves, and drop anything its
   Avoid list flags. Keep the artists in chronological show order.

4. Write the show spec to a temp file (use the Write tool, not `echo`) as a JSON array of
   `{ "artist": "<lookup name>", "billedArtist": "<as billed>", "venue": "<venue>",
   "showDate": "YYYY-MM-DD", "whyItMatches": "<rationale>", "tracks": ["<title>", ...] }`,
   then resolve each track against the Roon/Qobuz library:
   ```
   npm run downbeat -- dj:resolve < /tmp/downbeat-dj-spec.json > /tmp/downbeat-dj-resolved.json
   ```
   This prints `{ resolved: [...], unresolved: [...] }`. Note any unresolved tracks to report; if
   an artist loses too many, consider swapping in other popular titles and re-resolving.

5. Build the manifest from the resolved tracks, then queue the show into a zone:
   ```
   npm run downbeat -- dj:build < <(jq '{tracks: .resolved}' /tmp/downbeat-dj-resolved.json)
   npm run downbeat -- dj:queue            # add --zone "<name>" if ROON_ZONE isn't set
   ```
   (`dj:build` writes `data/dj-show.json` and prints the running order; `dj:queue` re-resolves
   each track in a live Roon session and loads them into the zone's queue in order — the first
   track plays now, the rest follow.)

6. Report: the running order, the zone, anything `dj:queue` skipped, and the names you dropped in
   step 2. Tell the user the show is playing in their Roon zone.
