---
description: Build a free "listen ahead" Apple Music song list for matched artists playing in LA soon
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Read
---

Maintain `data/playlist.md` — a tap-to-add Apple Music list of popular songs by the jazz
artists who matched the taste rubric and have an UPCOMING LA show. Past shows are pruned; new
ones get ~5 songs each. Free (no Spotify/Apple paid API): Last.fm supplies the popular songs,
and each is an Apple Music search link you tap to add manually.

## Prerequisites
- `.env` has `LASTFM_API_KEY` (https://www.last.fm/api/account/create). If missing, stop and
  tell the user to add it.

## Steps

1. Read `data/seen-events.json` (the ledger of matched shows). Keep only shows with `date` >= today.

2. **Normalize each billed name to a real recording artist** for the song lookup — the fuzzy
   part only you can do well:
   - Strip ensemble suffixes: "The Amanda Castro Band" → "Amanda Castro"; "Yotam Silberstein
     Trio" → "Yotam Silberstein"; "Mauricio Morales Quartet" → "Mauricio Morales".
   - For explicit **tributes / "Music of X"**, use the **honored** artist (the live repertoire):
     "Jaz Sawyer Quartet: Music of Coltrane" → "John Coltrane".
   - Drop names that don't map to a real recording artist (e.g. one-off all-star bills,
     "Tuesday Happenings") and report them as skipped.

3. Write the normalized list to a temp file (use the Write tool, not `echo`) as a JSON array of
   `{ "artist": "<lookup name>", "billedArtist": "<as billed>", "venue": "<venue>", "showDate": "YYYY-MM-DD" }`,
   then run:
   ```
   npm run downbeat -- playlist:build < /tmp/downbeat-playlist.json
   ```
   This prunes past-show songs, pulls ~5 popular songs per new upcoming artist from Last.fm,
   attaches an Apple Music tap-to-add link to each, records state in `data/playlist.json`
   (so re-runs don't double-add), and (re)writes `data/playlist.md`.

4. Report the summary it prints (artists added, songs added, songs pruned, any with no songs
   found), plus the names you skipped in step 2. Point the user to `data/playlist.md`.
