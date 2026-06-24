---
description: Produce a late-night jazz radio show — curated tracks from upcoming matched artists with Stephen Holloway DJ commentary — and queue it into a Roon zone
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Bash(jq *), Read, Write
---

Produce a late-night jazz radio show: real recordings from the artists who matched the taste
rubric and have an UPCOMING LA show, interleaved with short **Stephen Holloway** DJ commentary
(voiced by ElevenLabs), loaded **in order into a Roon zone's play queue** (intro clip → first
act's intro → its tracks → next act → … → outro). Built from `seen-events.json`, curated with
Last.fm + the rubric.

> **Why a queue, not a saved playlist:** Roon's community API only exposes transport actions on
> tracks, so the show is loaded into a zone's play queue. `dj:queue` loads it paused; to keep it,
> use Roon's **"Save Queue as Playlist"**.

## Prerequisites
- Roon on the same network with the **Downbeat DJ** extension enabled (Roon → Settings →
  Extensions). Set `ROON_ZONE` or pass `--zone` (list with `npm run downbeat -- roon:zones`).
- `.env`: `LASTFM_API_KEY`, `ELEVENLABS_API_KEY`. `ROON_DJ_CLIPS_DIR` must point at a
  Roon-watched Storage folder (a mounted share is fine). `ffmpeg` must be installed (tags clips).

## Steps

1. Read `data/seen-events.json` and `data/taste-rubric.md`. Keep only shows with `date` >= today.
   A full ledger is many shows — curate a tight show (aim ~4–6 acts), favoring the strongest
   rubric matches that are likely to have catalog on Qobuz; drop the rest and report them.

2. **Normalize each billed name to the artist whose catalog we'll play**, tracking *why* (the DJ
   needs it) — same rules as `/sync-playlist`:
   - Strip ensemble suffixes ("Yotam Silberstein Trio" → "Yotam Silberstein"). No substitution.
   - **Tributes / "Music of X"** and **leaders with no Qobuz catalog:** play the honored/source
     artist's own recordings and record it as a *substitution* (e.g. "Jaz Sawyer Quartet: Music of
     Coltrane" → play John Coltrane). Stephen Holloway will clarify it on air.
   - Drop names that map to no recording artist; report them as skipped.

3. **Curate ~2–4 canonical tracks per act.** Run `npm run downbeat -- lastfm:top --artist "<name>"
   --limit 8` for popularity, pick the best by the rubric (loved styles/eras; drop Avoids), and
   name titles precisely — prefer well-known studio versions. The resolver prefers an artist-led,
   sole-credit match but can't pick pressings; if unsure which exists, probe
   `npm run downbeat -- roon:search --artist "<a>" --title "<t>" --candidates`. Keep acts in
   chronological show order.

4. Write the show spec to a temp file (Write tool, not `echo`) — a JSON array of
   `{ "artist", "billedArtist", "venue", "showDate", "whyItMatches", "tracks":[...] }` (carry any
   substitution in `whyItMatches`) — then resolve against Roon/Qobuz:
   ```
   npm run downbeat -- dj:resolve < /tmp/downbeat-dj-spec.json > /tmp/downbeat-dj-resolved.json
   ```
   Check each `matchedTitle`/`matchedArtist`: if a track resolved to the wrong tune/version or is
   unresolved, swap the title and re-resolve. (`searchTrack` rejects wrong-titled matches, so
   unresolved usually means "not on Qobuz" — pick another canonical title.)

5. **Write the Stephen Holloway script**, then synthesize it. Holloway is a warm late-night host
   with personality — unhurried, a little dry wit, evocative after-hours imagery, the odd aside —
   but never corny or over-written. He says his name in the intro and signs off in the outro.
   Produce a JSON array of `ScriptSegment` — `{ "slot":"intro" }`, one
   `{ "slot":"artist", "artistKey":"<billedArtist>" }` per act (artistKey must equal the act's
   `billedArtist` so it interleaves correctly), and `{ "slot":"outro" }`, each with a `text` field.
   Rules:
   - **Run it like real radio with segues.** Each artist intro after the first **recaps the act we
     just heard** — name them and remind the listener *where and when* they play (venue + date) —
     then introduces the act coming up (also with its venue + date). The outro recaps the final act
     the same way. The first artist intro has nothing to recap; flow straight from the show intro.
   - **~60–110 words** per segment (a bit longer is fine now that intros do double duty). Spoken
     words only — conversational, no emojis, no stage directions.
   - **Ground only** in `taste-rubric.md` + the per-act context you have (venue, `showDate`,
     `whyItMatches`). **No invented facts** — no fake bios, dates, accolades, or anecdotes. The
     personality is in the *voice and phrasing*, not in made-up specifics.
   - **Speak the billed name, credit the recording artist.** For substitutions, clarify on air
     (e.g. "Tomorrow at Sam First, Jaz Sawyer's quartet plays the music of Coltrane — so here's
     Coltrane himself…").
   - **Spell out TTS-fragile bits**: dates as words ("June twenty-fifth"), avoid odd symbols.
   Write it to a temp file and synthesize (this clears prior clips, caches by text, tags each MP3):
   ```
   npm run downbeat -- dj:tts < /tmp/downbeat-dj-script.json > /tmp/downbeat-dj-clips.json
   ```

6. Build the manifest (interleaves clips + tracks) and queue the show:
   ```
   jq -s '{tracks: .[0].resolved, clips: .[1].clips}' \
     /tmp/downbeat-dj-resolved.json /tmp/downbeat-dj-clips.json > /tmp/downbeat-dj-build.json
   npm run downbeat -- dj:build < /tmp/downbeat-dj-build.json
   npm run downbeat -- dj:queue            # add --zone "<name>" if ROON_ZONE isn't set
   ```
   `dj:build` writes `data/dj-show.json` and prints the running order; `dj:queue` re-resolves each
   track live, polls until each freshly-written clip is indexed (~10-15s each), and loads the zone's
   queue in order, then **pauses**. (Pass `--play` to start playback.)

7. Report: the running order (clips + tracks, with any billed→played substitutions called out),
   the zone, anything `dj:queue` skipped, and the acts you dropped in step 1. Remind the user they
   can press play or "Save Queue as Playlist" in Roon.
