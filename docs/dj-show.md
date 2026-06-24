# `/dj-show` — A Jazz Radio Show With an Audience of One

> Design doc for a future feature. Not yet implemented.

## Context

Downbeat already finds upcoming LA jazz shows that match the user's taste (`/scan-jazz` → Todoist) and builds a free "listen ahead" Apple Music tap-to-add list (`/sync-playlist` → `data/playlist.md`). The click-and-add workflow works but is tedious.

The desired feature: an on-demand command that generates a **local jazz radio show for an audience of one** — real recordings from upcoming matched artists, interspersed with short DJ commentary scripted by Claude and voiced by ElevenLabs, played back as a continuous show.

**Key constraint that decided the architecture:** splicing custom audio *between* real recordings only works where we control local playback. Streaming catalogs (Apple Music, Qobuz's own player) won't let you insert arbitrary clips between their tracks, and a podcast RSS feed can't legally embed DRM'd streaming audio. The one clean home for the interspersed vision is **Roon**, which can interleave a local DJ MP3 with a Qobuz/library track in a single queue. This uses gear already owned (Qobuz subscription + local Roon server) and costs nothing beyond the existing ElevenLabs API.

**Decisions:** Roon at home (full vision); generated **on-demand** via a new `/dj-show` skill; ElevenLabs API key already available.

## Approach

Follow Downbeat's established split: **Claude does the fuzzy/creative work** (artist normalization, track curation, DJ scripting) in a `.claude/commands/dj-show.md` skill; a **deterministic TypeScript CLI** does all I/O (Roon control, ElevenLabs synthesis, manifest state). Reuse `seen-events.json`, `taste-rubric.md`, `lastfm.topTracks`, and the billed-name normalization rules from `sync-playlist.md`.

### End-to-end flow

```
seen-events.json (upcoming matched shows, date >= today)
   │  Claude: normalize billed→recording artist, curate tracks (lastfm:top + rubric)
   ▼  show-spec JSON
downbeat dj:resolve   → for each (artist,title): Roon Browse search → Qobuz track item_key
   ▼  resolved tracks (+ unresolved list)
   │  Claude: write DJ script segments grounded in rubric + per-artist context
   ▼  script JSON
downbeat dj:tts       → ElevenLabs synth each segment → MP3 in Roon-watched clips dir (cached by hash)
   ▼  clip files
downbeat dj:build     → interleave [intro][artistA clip][trackA1][trackA2][artistB clip]… → data/dj-show.json
   ▼
downbeat dj:enqueue   → Play Now segment[0], Add to Queue segment[1..N] in order, into target zone
   ▼
Roon plays the show
```

### Two load-bearing technical facts (validated via research)

1. **No queue reorder API.** Roon's community API cannot edit/reorder the queue. Ordering is built by *sequencing* Browse actions: **Play Now** the first segment (clears prior queue + starts), then **Add to Queue** (append) every later segment in manifest order. Avoid "Add Next" for multi-item runs — it inserts after the current track and reverses order. Confirm append ordering is stable across rapid sequential calls; may need to await each action / add a short settle delay.

2. **A freshly written local MP3 isn't instantly playable.** Roon must index a watched-folder file before Browse can find/enqueue it, and there's no public "rescan now" call. Strategy (decided by the Phase 0 spike):
   - **Preferred — pre-staged slot files:** create N permanent files (`dj-slot-01.mp3`…`dj-slot-12.mp3`) once so Roon indexes them permanently; each run overwrites bytes in place. *Must spike whether Roon plays new bytes from an overwritten file without a rescan.*
   - **Fallback — rescan-wait:** write uniquely-named clips, poll Browse search until each appears (timeout ~60–90s), then enqueue.
   - **Escape hatch:** if local-file playback proves unreliable, enqueue a music-only show and print the DJ patter to the terminal. Keeps the feature shippable.

### New modules (one-integration-per-module, matching `lastfm.ts`/`todoist.ts` style)

- **`src/roon.ts`** — Roon lifecycle + helpers. Deps: `node-roon-api`, `node-roon-api-transport`, `node-roon-api-browse`, `node-roon-api-status`.
  - `withRoon(fn)` — connect, wait for `core_paired` (timeout + "open Roon → Settings → Extensions → Enable Downbeat DJ" message), run `fn(ctx)`, disconnect. Wraps the event/callback API into one-shot CLI use. Persist the auth token to a gitignored state dir.
  - `listZones()`; `searchTrack(artist,title,zoneId)` → `{itemKey,matchedArtist,matchedTitle}|null` (Browse `hierarchy:"search"` → `load()` → drill into Tracks → first artist-matching hit); `searchLocalClip(title)`; `playNow(itemKey,zoneId)`; `addToQueue(itemKey,zoneId)`.
  - Note: `node-roon-api` ships no TS types — add a local `.d.ts` shim or scope `any` at the boundary (repo is `strict`).
- **`src/elevenlabs.ts`** — `synthesize(text,outPath)` → `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`, header `xi-api-key`, body `{text, model_id, voice_settings}`, default `mp3_44100_128`. `requireEnv`-style, `fetch`, helpful errors on non-2xx. **Cache by hash** of `text+voice+model` → skip API call if `<hash>.mp3` exists. Write a distinct ID3/title per slot so pre-staged clips are findable in Browse.
- **`src/showstore.ts`** (or extend `store.ts`) — load/save `data/dj-show.json`, tolerant of missing file (mirror `loadPlaylist`).

### New CLI commands (`src/cli.ts`, Commander, stdin-JSON + flags)

- `roon:zones` — list zones/outputs (debug + spike).
- `roon:search --artist --title [--zone]` — resolve one track (spike).
- `dj:resolve [--zone]` — stdin show-spec → resolved tracks + unresolved.
- `dj:tts [--voice --model]` — stdin script → synth segments to clips dir (cached).
- `dj:build` — stdin `{tracks, clips}` → interleave → write `data/dj-show.json`, print running order.
- `dj:enqueue [--zone]` — read manifest → ensure clips playable → Play Now first, Add to Queue rest in order.

### New skill `.claude/commands/dj-show.md` (orchestrator, modeled on `sync-playlist.md`)

1. Read `seen-events.json` + `taste-rubric.md`; filter to upcoming; **reuse `sync-playlist` normalization rules** (billed → recording artist; "Music of X" → honored artist).
2. Curate acts + tracks (use `lastfm:top` for popularity; prune rubric Avoids).
3. Write show-spec JSON to a temp file (Write tool, not echo — per existing convention) → `dj:resolve`.
4. Generate DJ script (see below), write JSON to temp file → `dj:tts`.
5. `dj:build`; confirm zone; `dj:enqueue`; print running order.

**DJ scripting (Claude, in the skill):** segments = show intro (~25–35s) / per-artist intro (~20–35s each) / outro (~20–30s). Grounded only in `taste-rubric.md` + provided per-artist context (venue, `showDate`, the stored `whyItMatches` rationale, optional Last.fm tags) — no hallucinated facts. ~45–110 words/segment, conversational, no emojis, spell out TTS-fragile bits ("June twenty-fifth"). Speak the *billed* name but credit the recording artist.

### Types / env / state

- `types.ts`: `ShowSpecArtist`, `ResolvedTrack`, `ScriptSegment` (`slot: "intro"|"artist"|"outro"`), `DjClip`, `ShowSegment` (`{kind:"clip"…} | {kind:"track"…}`), `DjShow {generatedAt, zone?, segments[]}`.
- `config.ts`: `djShow: data/dj-show.json`, `djClipsDir` (env `ROON_DJ_CLIPS_DIR`), `roonStateDir`.
- `.env` + `.env.example` + README: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` (optional), `ROON_DJ_CLIPS_DIR`, `ROON_ZONE`.
- `.gitignore`: `data/dj-show.json`, clips dir, Roon state dir.

## Phasing

- **Phase 0 — Spike the two unknowns** (throwaway scripts, build nothing reusable): pairing/auth + `roon:zones`; `searchTrack` finds a Qobuz track; **Play Now → Add to Queue → Add to Queue** yields expected order in a real zone; **whether an overwritten pre-staged DJ-slot MP3 plays new bytes without a manual rescan**, and how long rescan-wait takes. This decides the local-clip strategy and de-risks everything.
- **Phase 1 — Music-only show:** `src/roon.ts`, `roon:zones`, `roon:search`, `dj:resolve`, `dj:build` (tracks only), `dj:enqueue`. Skill enqueues a pure curated music set. Proves the riskiest path with zero ElevenLabs dependency.
- **Phase 2 — Add DJ clips:** `src/elevenlabs.ts`, `dj:tts`, interleave clips in `dj:build`, local-clip playback in `dj:enqueue` via the Phase-0–winning strategy. Ship `/dj-show` end-to-end.
- **Phase 3 — Polish:** caching, voice/time-budget tuning, graceful unresolved-track handling (skip + mention in outro), `--zone`/`--artists`/`--tracks-per-artist` flags, terminal fallback.

## Critical files

- `src/cli.ts` — add `roon:*` and `dj:*` commands (match existing stdin-JSON idioms).
- `src/types.ts` — new interfaces above.
- `src/config.ts` — new paths + env.
- `src/store.ts` — reference for tolerant load/save (`loadPlaylist`); extend or mirror in `showstore.ts`.
- `src/lastfm.ts` — reuse `topTracks` for curation.
- `.claude/commands/sync-playlist.md` — reuse normalization rules; model the new skill on it.
- **New:** `src/roon.ts`, `src/elevenlabs.ts`, `.claude/commands/dj-show.md` (and optional `src/showstore.ts`).

## Verification

- **Phase 0:** run the spike scripts against the live Roon Core; visually confirm a 3-item queue plays in the intended order in a chosen zone; confirm a re-synthesized DJ-slot file plays its new audio.
- **Phase 1:** `/dj-show` (music-only) → confirm `data/dj-show.json` running order matches the curated set and the Roon zone plays it through in order.
- **Phase 2:** full `/dj-show` → confirm clips and tracks alternate correctly, DJ intros name the right artist/venue/date, and audio is audible in the zone. Spot-check a "Music of X" tribute resolves to the honored artist's catalog.
- **Unit-ish:** `roon:search --artist "Bill Evans" --title "Waltz for Debby"` returns a Qobuz item; `dj:tts` with one segment writes a playable MP3 and re-runs hit the cache (no second API call).

## Open questions / assumptions

- Is the machine running Downbeat the same as (or able to write to a watched folder on) the Roon Core? (Required for local clips.)
- Is Qobuz the only streaming service enabled in Roon, or must Browse search disambiguate Qobuz vs. Tidal/library? ("First hit" may not be Qobuz otherwise.)
- Preferred default zone (`ROON_ZONE`) and chosen ElevenLabs voice id (a warm late-night-radio voice).
- Acceptable to require a one-time "Enable extension" click in Roon → Settings → Extensions.

## References

- [RoonLabs/node-roon-api](https://github.com/RoonLabs/node-roon-api) · [node-roon-api-browse](https://github.com/RoonLabs/node-roon-api-browse) · [JSDoc](https://roonlabs.github.io/node-roon-api/)
- [Roon community: queue management limitations](https://community.roonlabs.com/t/how-to-implement-queue-management/45501)
- [ElevenLabs: Create speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
