---
description: Queue a curated jazz show of upcoming matched artists into a Roon zone (music-only; DJ commentary lands in Phase 2)
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Read, Write
---

Queue a curated **Roon** show of real recordings from the jazz artists who matched the taste
rubric and have an UPCOMING LA show. Built from `seen-events.json`, curated with Last.fm + the
rubric, resolved against the Roon/Qobuz library, and loaded **in order into a Roon zone's play
queue** (first track plays now, the rest follow).

> **Why a queue, not a saved playlist:** a Phase-0 spike found Roon's community API exposes only
> transport actions (Play/Queue) on tracks — it cannot create or edit a saved playlist. So the show
> is loaded into a zone's play queue. To keep it, Roon's queue has a **"Save Queue as Playlist"**
> action you can use after `dj:queue` (which loads the queue and pauses by default).

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

2. **Normalize each billed name to the artist whose catalog we'll actually play** — same rules as
   `/sync-playlist`, but track *why* you remapped, because the Phase-2 DJ script needs to explain it:
   - Strip ensemble suffixes: "The Amanda Castro Band" → "Amanda Castro"; "Yotam Silberstein
     Trio" → "Yotam Silberstein". (No substitution — same artist.)
   - **Tributes / "Music of X":** the billed act usually has no recordings on Qobuz, so play the
     **honored** artist's originals: "Jaz Sawyer Quartet: Music of Coltrane" → play **John
     Coltrane**. This is a *substitution* — record it (see step 4) so Stephen Holloway can clarify
     in the lead-in (e.g. "tonight at Sam First, Jaz Sawyer's quartet plays the music of Coltrane —
     here's Coltrane's own…").
   - **Leader with a thin/absent Qobuz catalog:** if a quick check suggests the billed leader isn't
     on Qobuz, fall back to the most relevant well-recorded artist on the bill (or the repertoire's
     source) and record it as a substitution.
   - Drop names that don't map to any recording artist and report them as skipped.

3. **Curate ~2–4 canonical tracks per artist.** Run
   `npm run downbeat -- lastfm:top --artist "<name>" --limit 8` for popularity, then pick the 2–4
   best **using the rubric** (prefer loved styles/eras; drop Avoids). Choose **canonical
   recordings** and name the title precisely — the resolver prefers an *artist-led* match but can't
   tell pressings apart, so favor well-known studio versions and avoid titles that only exist as
   live/alternate takes unless you mean them. When in doubt about which version exists, probe with
   `npm run downbeat -- roon:search --artist "<a>" --title "<t>" --candidates` and read the ranked
   list. Keep artists in chronological show order.

4. Write the show spec to a temp file (use the Write tool, not `echo`) as a JSON array of
   `{ "artist": "<artist we play>", "billedArtist": "<as billed at the venue>", "venue": "<venue>",
   "showDate": "YYYY-MM-DD", "whyItMatches": "<rationale; include any substitution, e.g. 'tribute —
   billed Jaz Sawyer Quartet plays Music of Coltrane, so we play Coltrane'>", "tracks": ["<title>", ...] }`,
   then resolve each track against the Roon/Qobuz library:
   ```
   npm run downbeat -- dj:resolve < /tmp/downbeat-dj-spec.json > /tmp/downbeat-dj-resolved.json
   ```
   This prints `{ resolved: [...], unresolved: [...] }`. For each unresolved track, swap in another
   canonical title and re-resolve; if the chosen `matchedArtist`/`matchedTitle` looks like the wrong
   version, refine the title and re-resolve. Carry `billedArtist` through so the DJ can speak the
   billed name while we credit the recording artist.

5. Build the manifest from the resolved tracks, then load the queue:
   ```
   npm run downbeat -- dj:build < <(jq '{tracks: .resolved}' /tmp/downbeat-dj-resolved.json)
   npm run downbeat -- dj:queue            # add --zone "<name>" if ROON_ZONE isn't set
   ```
   (`dj:build` writes `data/dj-show.json` and prints the running order; `dj:queue` re-resolves each
   track live and loads them into the zone's queue in order, then **pauses** so the queue is ready
   to play or to "Save Queue as Playlist" in Roon. Pass `--play` to start playback instead.)

6. Report: the running order (with any billed→played substitutions called out), the zone, anything
   `dj:queue` skipped, and the names you dropped in step 2. Remind the user they can press play, or
   save the queue as a playlist in Roon.
