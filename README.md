# Downbeat

Finds live jazz shows you'll actually like and files them as review tasks in Todoist.

It works in three stages:

1. **Track venues** — an approved list of LA-area jazz rooms in [`data/venues.md`](data/venues.md).
2. **Know your taste** — a rubric in [`data/taste-rubric.md`](data/taste-rubric.md), seeded from
   your Discogs collection (loved artists weighted by album count, preferred styles/eras, and
   dislikes *inferred from what's absent* — e.g. acoustic Miles but no electric/fusion).
3. **Scan & file** — each scan fetches venue calendars, matches upcoming shows against the
   rubric, and auto-creates Todoist "review" tasks with a rationale and artist links.

## Architecture

The heavy reasoning (reading venue pages, judging taste-fit, analyzing the collection) is done
by two **Claude Code commands**. A small **TypeScript CLI** does the deterministic work:
Discogs API, Todoist API, the dedup ledger, and link building.

| Piece | What it does |
|-------|--------------|
| `/build-rubric` | Pulls Discogs, analyzes it, writes `data/taste-rubric.md`. |
| `/scan-jazz`    | Fetches venues, matches shows, creates Todoist tasks. |
| `/sync-playlist`| Builds a free Apple Music "listen ahead" song list for matched artists playing soon. |
| `/dj-show`      | Queues a curated **Roon** show of upcoming matched artists into a zone (music-only for now). |
| `src/cli.ts`    | `discogs:dump`, `todoist:*`, `seen:*`, `links`, `lastfm:top`, `playlist:build`, `roon:search`, `roon:zones`, `dj:*`. |

## Setup

Requires Node 18+.

```sh
npm install
cp .env.example .env   # then fill in the values
```

`.env` keys:

- `DISCOGS_USERNAME` / `DISCOGS_TOKEN` — token from <https://www.discogs.com/settings/developers>
- `TODOIST_TOKEN` — Todoist → Settings → Integrations → Developer → API token
- `TODOIST_PROJECT` — defaults to `Events & Entertainment` (created if missing)

## Usage

```sh
# 1. Build your taste rubric from Discogs (run once, or whenever your collection grows)
/build-rubric            # in Claude Code

# 2. Scan venues and file matching shows to Todoist
/scan-jazz               # in Claude Code
```

The CLI helpers can also be run directly:

```sh
npm run downbeat -- discogs:dump
npm run downbeat -- todoist:project --name "Events & Entertainment"
npm run downbeat -- links --artist "John Coltrane"
```

## "Listen ahead" song list (optional, free)

Maintains `data/playlist.md` — a tap-to-add list of popular songs by the matched artists who
have an upcoming LA show, so you can preview who's about to play nearby. Past shows are pruned
automatically.

> **Why a list instead of a real playlist:** writing directly to a streaming service costs
> money — the Apple Music API needs the paid Apple Developer Program ($99/yr), and Spotify now
> requires the app owner to have Spotify Premium (~$144/yr). So this stays free: **Last.fm**
> supplies the popular songs (Spotify removed its own top-tracks endpoint in Feb 2026), and
> each song is an **Apple Music search link** you tap to add to your library/playlist.

One-time setup (free): get a Last.fm API key at <https://www.last.fm/api/account/create> and
put it in `.env` as `LASTFM_API_KEY`.

Then, anytime:

```sh
/sync-playlist     # in Claude Code — prunes past shows, adds ~5 songs per new upcoming artist
```

Open `data/playlist.md` and tap the song links to add them in Apple Music.

## DJ show — a curated Roon queue (optional)

`/dj-show` curates real recordings from the matched artists with an upcoming LA show and loads
them, in order, into a **Roon zone's play queue** (first track plays now, the rest follow). It's
the foundation for a future "jazz radio hour" where ElevenLabs-voiced DJ commentary is interleaved
between songs — but **this first phase is music-only**. See the design in
[`docs/dj-show.md`](docs/dj-show.md).

> **Why a queue, not a saved playlist:** a Phase-0 spike against the live Core found Roon's
> community API exposes only *transport* actions (Play / Queue / Start Radio) on tracks — reached
> via search, library, or even an existing playlist. It has no "Add to Playlist"/"Add to Library"
> action, so it can't create or edit a saved playlist. Queueing to a zone is the way to assemble
> an ordered show, and the only path that can later interleave local DJ clips.

One-time setup:

1. Run Roon on your network with a Qobuz subscription enabled.
2. The first `/dj-show` (or `npm run downbeat -- roon:zones`) appears in Roon →
   **Settings → Extensions** as **Downbeat DJ** — enable it once. The pairing token is then
   cached under `data/.roon-state/`.
3. Optionally set `ROON_ZONE` in `.env` to your preferred zone (else pass `--zone`, or it
   auto-picks when there's a single zone).

Then, anytime:

```sh
/dj-show                 # in Claude Code — curates, resolves, and queues the show to a zone

# Or drive the CLI directly:
npm run downbeat -- roon:zones                                                  # list zones
npm run downbeat -- roon:search --artist "Bill Evans" --title "Waltz for Debby" # pairing/search check
npm run downbeat -- dj:resolve   < spec.json      # show spec → resolved Qobuz tracks
npm run downbeat -- dj:build     < resolved.json  # → data/dj-show.json (running order)
npm run downbeat -- dj:queue --zone "Living Room" # load the show into the zone's queue, in order
```

## Notes

- **Artist links** are pre-filled Apple Music + AllMusic *search* URLs (neither offers a free
  exact-artist-page lookup).
- **Dedup** is keyed on `venue|date|artist` in `data/seen-events.json`, so re-scanning won't
  create duplicate tasks.
- Some venues in `data/venues.md` need their calendar URL confirmed (notably **Blue Note** —
  there's no well-known Blue Note jazz club in LA). The scanner skips any venue whose URL is
  still marked `<CONFIRM …>`.
