---
description: Build a curated Roon playlist of upcoming matched jazz artists (music-only; DJ commentary lands in Phase 2)
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Read, Write
---

Generate a curated **Roon** playlist of real recordings from the jazz artists who matched the
taste rubric and have an UPCOMING LA show. Built from `seen-events.json`, curated with Last.fm +
the rubric, resolved against the Roon/Qobuz library, and assembled in order into a named Roon
playlist you press play on yourself.

> **This phase is music-only.** The DJ persona (Stephen Holloway) and ElevenLabs-voiced commentary
> are Phase 2 — not generated here. This produces a clean curated music playlist and proves the
> Roon assembly path. Don't write or synthesize DJ patter.

## Prerequisites
- Roon is running on the same network, with the **Downbeat DJ** extension enabled (Roon →
  Settings → Extensions). The first run prints how to enable it if it isn't paired yet.
- `.env` has `LASTFM_API_KEY` (used for track popularity). Optionally `ROON_PLAYLIST_NAME`.

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

5. Build the manifest from the resolved tracks, then assemble the Roon playlist:
   ```
   npm run downbeat -- dj:build < <(jq '{tracks: .resolved}' /tmp/downbeat-dj-resolved.json)
   npm run downbeat -- dj:playlist
   ```
   (`dj:build` writes `data/dj-show.json` and prints the running order; `dj:playlist` re-resolves
   each track in a live Roon session and adds them in order, creating the playlist named by
   `ROON_PLAYLIST_NAME` unless you pass `--name`.)

6. Report: the running order, the playlist name, anything `dj:playlist` skipped, and the names you
   dropped in step 2. Tell the user the playlist is ready to play in Roon (any zone, anytime).
