# Downbeat

Finds live jazz shows you'll actually like and builds a **Roon DJ radio show** from them.

It works in three stages:

1. **Track venues** — an approved list of LA-area jazz rooms in [`data/venues.md`](data/venues.md).
2. **Know your taste** — a rubric in [`data/taste-rubric.md`](data/taste-rubric.md), seeded from
   your Discogs collection (loved artists weighted by album count, preferred styles/eras, and
   dislikes *inferred from what's absent* — e.g. acoustic Miles but no electric/fusion).
3. **Scan & build the show** — each scan fetches venue calendars, matches upcoming shows against
   the rubric, and records the matches; `/dj-show` then turns them into a curated **The Blue Hour**
   show in Roon, with Stephen Holloway DJ commentary.

## Architecture

The heavy reasoning (reading venue pages, judging taste-fit, analyzing the collection) is done
by the **Claude Code commands**. A small **TypeScript CLI** does the deterministic work:
Discogs API, the dedup ledger, the calendar (.ics) build, Last.fm popularity, and Roon/ElevenLabs
assembly.

| Piece | What it does |
|-------|--------------|
| `/build-rubric` | Pulls Discogs, analyzes it, writes `data/taste-rubric.md`. |
| `/downbeat`     | Runs the whole pipeline end to end: `/scan-jazz` then `/dj-show`. |
| `/scan-jazz`    | Fetches venues, matches shows, records matches to the ledger, publishes the calendar. |
| `/dj-show`      | Builds **The Blue Hour** — a **Roon** show of curated tracks + Stephen Holloway DJ commentary — queued to a zone. |
| `src/cli.ts`    | `discogs:dump`, `seen:*`, `lastfm:top`, `ics:build`, `roon:*`, `dj:*`. |

## Setup

Requires Node 18+.

```sh
npm install
cp .env.example .env   # then fill in the values
```

`.env` keys:

- `DISCOGS_USERNAME` / `DISCOGS_TOKEN` — token from <https://www.discogs.com/settings/developers>

(Last.fm, Roon, and ElevenLabs keys for `/dj-show` are covered in its section below.)

## Usage

```sh
# 1. Build your taste rubric from Discogs (run once, or whenever your collection grows)
/build-rubric            # in Claude Code

# 2. Scan venues and record matching shows to the ledger
/scan-jazz               # in Claude Code

# 3. Build the Blue Hour show in Roon from the matches
/dj-show                 # in Claude Code

# Or do steps 2–3 in one pass:
/downbeat                # in Claude Code — scans, matches, then builds the show
```

The CLI helpers can also be run directly:

```sh
npm run downbeat -- discogs:dump
npm run downbeat -- seen:check --venue "Sam First" --date "2026-07-01" --artist "John Coltrane"
npm run downbeat -- lastfm:top --artist "John Coltrane"
```

## Subscribe to the show calendar

Every scan publishes a subscribe-able calendar of the upcoming matched shows — with dates, times,
ticket links, and a one-line "why you'd like it" — built straight from the ledger:

```sh
npm run downbeat -- ics:build   # writes docs/calendar.ics + docs/index.html (upcoming shows)
```

`/scan-jazz` and `/downbeat` run this for you; committing and pushing `docs/` publishes it via
**GitHub Pages**:

- **Calendar:** `https://dansays.github.io/downbeat/calendar.ics`
- **Subscribe (auto-refreshing):** `webcal://dansays.github.io/downbeat/calendar.ics` — or open the
  landing page at `https://dansays.github.io/downbeat/` and tap **Subscribe**.

One-time setup: enable Pages at repo **Settings → Pages → Deploy from a branch → `main` `/docs`**.
Shows with a captured start time become timed events (America/Los_Angeles, 2-hour default);
older entries without a time show as all-day until a re-scan backfills them. Override the public
URL with `CALENDAR_BASE_URL`.

## The Blue Hour — a late-night jazz radio hour in Roon

`/dj-show` produces **The Blue Hour**, a late-night radio show from the matched artists with an
upcoming LA show: curated recordings interleaved with short **Stephen Holloway** DJ commentary
(voiced by ElevenLabs), loaded **in order into a Roon zone's play queue** — intro → each act's
spoken intro → its tracks → … → outro. See the design in [`docs/dj-show.md`](docs/dj-show.md).

> **Why a queue, not a saved playlist:** a Phase-0 spike against the live Core found Roon's
> community API exposes only *transport* actions (Play / Queue / Start Radio) on tracks — reached
> via search, library, or even an existing playlist. It has no "Add to Playlist"/"Add to Library"
> action, so it can't create or edit a saved playlist. Queueing to a zone is the way to assemble
> an ordered show, and the only path that can later interleave local DJ clips. `dj:queue` loads
> the queue and **pauses** by default, so you can press play or use Roon's **"Save Queue as
> Playlist"** to keep it — which recovers a real saved playlist. Pass `--play` to start playback.

One-time setup:

1. Run Roon on your network with a Qobuz subscription enabled.
2. The first `/dj-show` (or `npm run downbeat -- roon:zones`) appears in Roon →
   **Settings → Extensions** as **Downbeat DJ** — enable it once. The pairing token is then
   cached under `data/.roon-state/`.
3. In `.env`: add `ELEVENLABS_API_KEY` (for the DJ voice) and set `ROON_DJ_CLIPS_DIR` to a
   **Roon-watched Storage folder** (a mounted share is fine) — Downbeat writes the DJ clips there
   and Roon indexes them (~10-15s) so they can be queued. Install `ffmpeg` (tags the clips).
   Optionally set `ROON_ZONE` (else pass `--zone`, or it auto-picks a single zone).

Then, anytime:

```sh
/dj-show                 # in Claude Code — curates, scripts + voices the DJ, queues the show

# Or drive the CLI directly:
npm run downbeat -- roon:zones                       # list zones
npm run downbeat -- dj:resolve < spec.json   > resolved.json  # show spec → resolved Qobuz tracks
npm run downbeat -- dj:tts     < script.json > clips.json     # Holloway script → tagged MP3 clips
# combine: jq -s '{tracks:.[0].resolved, clips:.[1].clips}' resolved.json clips.json > build.json
npm run downbeat -- dj:build   < build.json          # interleave clips+tracks → data/dj-show.json
npm run downbeat -- dj:queue --zone "Living Room"    # load the queue in order, paused (--play to start)
```

## Notes

- **Dedup** is keyed on `venue|date|artist` in `data/seen-events.json`, so re-scanning won't
  record the same match twice.
- Some venues in `data/venues.md` need their calendar URL confirmed (notably **Blue Note** —
  there's no well-known Blue Note jazz club in LA). The scanner skips any venue whose URL is
  still marked `<CONFIRM …>`.
