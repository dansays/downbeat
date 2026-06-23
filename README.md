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
| `src/cli.ts`    | `discogs:dump`, `todoist:project`, `todoist:add`, `seen:check/add`, `links`. |

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

## Notes

- **Artist links** are pre-filled Apple Music + AllMusic *search* URLs (neither offers a free
  exact-artist-page lookup).
- **Dedup** is keyed on `venue|date|artist` in `data/seen-events.json`, so re-scanning won't
  create duplicate tasks.
- Some venues in `data/venues.md` need their calendar URL confirmed (notably **Blue Note** —
  there's no well-known Blue Note jazz club in LA). The scanner skips any venue whose URL is
  still marked `<CONFIRM …>`.
