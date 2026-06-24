# `/dj-show` — A Jazz Radio Show With an Audience of One

> Design doc for a future feature. Not yet implemented.

## Context

Downbeat already finds upcoming LA jazz shows that match the user's taste (`/scan-jazz` → Todoist) and builds a free "listen ahead" Apple Music tap-to-add list (`/sync-playlist` → `data/playlist.md`). The click-and-add workflow works but is tedious.

The desired feature: an on-demand command that **generates** a local-jazz-radio-show playlist for an audience of one — real recordings from upcoming matched artists, interleaved with short DJ commentary scripted by Claude and voiced by ElevenLabs, assembled into a single ordered **Roon playlist**.

**Scope:** this feature only *generates* the playlist. It does **not** play it back, control transport, or select Roon zones — the user presses play themselves, in whatever zone they like, whenever they want.

**Key constraint that decided the architecture:** mixing custom audio *with* real recordings in one playlist only works where we control local content. Apple Music / Qobuz-native playlists can't hold arbitrary local audio (the DJ clips), and a podcast RSS feed can't legally embed DRM'd streaming audio. The one place that can hold local DJ MP3s **and** Qobuz tracks in a single ordered playlist is **Roon**. This uses gear already owned (Qobuz subscription + local Roon server) and costs nothing beyond the existing ElevenLabs API.

**Decisions:** Roon at home; generated **on-demand** via a new `/dj-show` skill; ElevenLabs API key already available; generation-only (no playback).

## Approach

Follow Downbeat's established split: **Claude does the fuzzy/creative work** (artist normalization, track curation, DJ scripting) in a `.claude/commands/dj-show.md` skill; a **deterministic TypeScript CLI** does all I/O (Roon browse + playlist assembly, ElevenLabs synthesis, manifest state). Reuse `seen-events.json`, `taste-rubric.md`, `lastfm.topTracks`, and the billed-name normalization rules from `sync-playlist.md`.

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
downbeat dj:playlist  → create/replace a named Roon playlist, adding each segment in order
   ▼
Playlist sits in Roon, ready for the user to play whenever/wherever they like
```

`data/dj-show.json` is the always-produced source-of-truth manifest. The Roon playlist is built from it; if Roon playlist assembly proves unworkable (see fact 1), the manifest + clip files are still a usable artifact.

### Two load-bearing technical facts

1. **Playlist assembly via the community API is the main unknown — spike it first.** Roon's community API has no playlist *reorder* call, so order must be built by adding tracks to the playlist **one at a time, in sequence**. The mechanism is the Browse "Add to Playlist" action surfaced when you drill into a track's `item_key` (with a sub-action to create a new playlist or append to an existing one). This must be validated: confirm the Browse API actually exposes Add-to-Playlist, whether it can target a new vs. existing playlist by name, whether sequential adds preserve order (may need to await each action / add a short settle delay), and whether it works **without** a zone (adding to a playlist is not playback, so it likely needs no `zone_or_output_id` — confirm). If create/append isn't viable through the API, fall back to emitting `data/dj-show.json` + clips and assembling the playlist manually.

2. **A freshly written local MP3 isn't immediately addable.** Roon must index a watched-folder file before Browse can find it and add it to a playlist, and there's no public "rescan now" call. Strategy (decided by the Phase 0 spike):
   - **Preferred — pre-staged slot files:** create N permanent files (`dj-slot-01.mp3`…`dj-slot-12.mp3`) once so Roon indexes them permanently; each run overwrites bytes in place. *Must spike whether Roon serves new bytes from an overwritten file without a rescan.*
   - **Fallback — rescan-wait:** write uniquely-named clips, poll Browse search until each appears (timeout ~60–90s), then add.
   - **Escape hatch:** if local clips can't be added reliably, build a music-only Roon playlist and emit the DJ patter as text alongside the manifest. Keeps the feature shippable.

### New modules (one-integration-per-module, matching `lastfm.ts`/`todoist.ts` style)

- **`src/roon.ts`** — Roon lifecycle + browse/playlist helpers. Deps: `node-roon-api`, `node-roon-api-browse`, `node-roon-api-status`. (No transport service — we don't play or read zones.)
  - `withRoon(fn)` — connect, wait for `core_paired` (timeout + "open Roon → Settings → Extensions → Enable Downbeat DJ" message), run `fn(ctx)`, disconnect. Wraps the event/callback API into one-shot CLI use. Persist the auth token to a gitignored state dir.
  - `searchTrack(artist,title)` → `{itemKey,matchedArtist,matchedTitle}|null` (Browse `hierarchy:"search"` → `load()` → drill into Tracks → first artist-matching hit); `searchLocalClip(title)` → item_key for a DJ clip; `addToPlaylist(itemKey, playlistName, {create})` — invoke the Browse Add-to-Playlist action.
  - Note: `node-roon-api` ships no TS types — add a local `.d.ts` shim or scope `any` at the boundary (repo is `strict`).
- **`src/elevenlabs.ts`** — `synthesize(text,outPath)` → `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`, header `xi-api-key`, body `{text, model_id, voice_settings}`, default `mp3_44100_128`. `requireEnv`-style, `fetch`, helpful errors on non-2xx. **Cache by hash** of `text+voice+model` → skip API call if `<hash>.mp3` exists. Write a distinct ID3/title per slot so pre-staged clips are findable in Browse.
  - **Default voice: "Boe Deepman"** (`voice_id: XFQFwy8OEb9lvFQIMZ5a`) — a mellow, almost sleepy delivery that fits the late-night jazz-radio-hour mood. Set this as the `ELEVENLABS_VOICE_ID` default.
- **`src/showstore.ts`** (or extend `store.ts`) — load/save `data/dj-show.json`, tolerant of missing file (mirror `loadPlaylist`).

### New CLI commands (`src/cli.ts`, Commander, stdin-JSON + flags)

- `roon:search --artist --title` — resolve one track to its Qobuz item (spike + debug).
- `dj:resolve` — stdin show-spec → resolved tracks + unresolved.
- `dj:tts [--voice --model]` — stdin script → synth segments to clips dir (cached).
- `dj:build` — stdin `{tracks, clips}` → interleave → write `data/dj-show.json`, print running order.
- `dj:playlist [--name]` — read manifest → ensure clips are indexed → create/replace the named Roon playlist, adding each segment in order; print what it added and any items it skipped.

### New skill `.claude/commands/dj-show.md` (orchestrator, modeled on `sync-playlist.md`)

1. Read `seen-events.json` + `taste-rubric.md`; filter to upcoming; **reuse `sync-playlist` normalization rules** (billed → recording artist; "Music of X" → honored artist).
2. Curate acts + tracks (use `lastfm:top` for popularity; prune rubric Avoids).
3. Write show-spec JSON to a temp file (Write tool, not echo — per existing convention) → `dj:resolve`.
4. Generate DJ script (see below), write JSON to temp file → `dj:tts`.
5. `dj:build`; then `dj:playlist`; print the running order and tell the user the playlist is ready to play in Roon.

**DJ scripting (Claude, in the skill):** the DJ persona is **Stephen Holloway** — a warm, unhurried late-night host who introduces himself by name in the show intro and signs off as himself in the outro. Segments = show intro (~25–35s) / per-artist intro (~20–35s each) / outro (~20–30s). Grounded only in `taste-rubric.md` + provided per-artist context (venue, `showDate`, the stored `whyItMatches` rationale, optional Last.fm tags) — no hallucinated facts. ~45–110 words/segment, conversational, no emojis, spell out TTS-fragile bits ("June twenty-fifth"). Speak the *billed* name but credit the recording artist.

### Types / env / state

- `types.ts`: `ShowSpecArtist`, `ResolvedTrack`, `ScriptSegment` (`slot: "intro"|"artist"|"outro"`), `DjClip`, `ShowSegment` (`{kind:"clip"…} | {kind:"track"…}`), `DjShow {generatedAt, playlistName?, segments[]}`.
- `config.ts`: `djShow: data/dj-show.json`, `djClipsDir` (env `ROON_DJ_CLIPS_DIR`), `roonStateDir`.
- `.env` + `.env.example` + README: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (default `XFQFwy8OEb9lvFQIMZ5a` — "Boe Deepman"), `ELEVENLABS_MODEL` (optional), `ROON_DJ_CLIPS_DIR`, `ROON_PLAYLIST_NAME` (default e.g. "Downbeat — Late Night").
- `.gitignore`: `data/dj-show.json`, clips dir, Roon state dir.

## Phasing

- **Phase 0 — Spike the two unknowns** (throwaway scripts, build nothing reusable): pairing/auth works against the user's Core; `searchTrack` finds a Qobuz track; **the Browse Add-to-Playlist flow** can create/append a named playlist and sequential adds preserve order (fact 1); **whether an overwritten pre-staged DJ-slot MP3 is served as new bytes without a manual rescan**, and how long rescan-wait actually takes (fact 2). This decides the playlist + local-clip strategy and de-risks everything.
- **Phase 1 — Music-only playlist:** `src/roon.ts`, `roon:search`, `dj:resolve`, `dj:build` (tracks only), `dj:playlist`. Skill assembles a pure curated music playlist in Roon. Proves the riskiest path with zero ElevenLabs dependency.
- **Phase 2 — Add DJ clips:** `src/elevenlabs.ts`, `dj:tts`, interleave clips in `dj:build`, add local clips to the playlist in `dj:playlist` via the Phase-0–winning strategy. Ship `/dj-show` end-to-end.
- **Phase 3 — Polish:** caching, voice/time-budget tuning, graceful unresolved-track handling (skip + mention in outro), `--name`/`--artists`/`--tracks-per-artist` flags, text-patter fallback.

## Critical files

- `src/cli.ts` — add `roon:*` and `dj:*` commands (match existing stdin-JSON idioms).
- `src/types.ts` — new interfaces above.
- `src/config.ts` — new paths + env.
- `src/store.ts` — reference for tolerant load/save (`loadPlaylist`); extend or mirror in `showstore.ts`.
- `src/lastfm.ts` — reuse `topTracks` for curation.
- `.claude/commands/sync-playlist.md` — reuse normalization rules; model the new skill on it.
- **New:** `src/roon.ts`, `src/elevenlabs.ts`, `.claude/commands/dj-show.md` (and optional `src/showstore.ts`).

## Verification

- **Phase 0:** run the spike scripts against the live Roon Core; confirm a 3-item test playlist is created in the right order and shows up in Roon; confirm a re-synthesized DJ-slot file is added with its new audio.
- **Phase 1:** `/dj-show` (music-only) → confirm `data/dj-show.json` running order matches the curated set and the named Roon playlist contains the same tracks in the same order.
- **Phase 2:** full `/dj-show` → open the Roon playlist and confirm clips and tracks alternate correctly and DJ intros name the right artist/venue/date. Spot-check a "Music of X" tribute resolves to the honored artist's catalog.
- **Unit-ish:** `roon:search --artist "Bill Evans" --title "Waltz for Debby"` returns a Qobuz item; `dj:tts` with one segment writes a playable MP3 and re-runs hit the cache (no second API call).

## Open questions / assumptions

- Does the community Browse API reliably support **creating and appending a named playlist** (Add-to-Playlist action), and does it work without a zone? (Fact 1 — the central spike.)
- Is the machine running Downbeat the same as (or able to write to a watched folder on) the Roon Core? (Required for local clips.)
- Is Qobuz the only streaming service enabled in Roon, or must Browse search disambiguate Qobuz vs. Tidal/library? ("First hit" may not be Qobuz otherwise.)
- Preferred default playlist name (`ROON_PLAYLIST_NAME`). (DJ voice is decided: "Boe Deepman", `XFQFwy8OEb9lvFQIMZ5a`; persona is Stephen Holloway.)
- Acceptable to require a one-time "Enable extension" click in Roon → Settings → Extensions.

## References

- [RoonLabs/node-roon-api](https://github.com/RoonLabs/node-roon-api) · [node-roon-api-browse](https://github.com/RoonLabs/node-roon-api-browse) · [JSDoc](https://roonlabs.github.io/node-roon-api/)
- [Roon community: queue management limitations](https://community.roonlabs.com/t/how-to-implement-queue-management/45501)
- [ElevenLabs: Create speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
