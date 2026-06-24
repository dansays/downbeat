import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root (one level up from src/). */
export const ROOT = resolve(__dirname, "..");

/** Absolute paths to the data files the tool reads and writes. */
export const PATHS = {
  venues: resolve(ROOT, "data/venues.md"),
  rubric: resolve(ROOT, "data/taste-rubric.md"),
  seen: resolve(ROOT, "data/seen-events.json"),
  playlist: resolve(ROOT, "data/playlist.json"), // state for dedup/prune
  playlistMd: resolve(ROOT, "data/playlist.md"), // human-readable listen-ahead list
  djShow: resolve(ROOT, "data/dj-show.json"), // source-of-truth manifest for /dj-show
} as const;

/** Read a required env var or throw a helpful error. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in (see README).`,
    );
  }
  return value;
}

export const TODOIST_PROJECT = process.env.TODOIST_PROJECT || "Events & Entertainment";

/** Identifies the app to Discogs; required by their API. */
export const USER_AGENT = "Downbeat/0.1 (+https://github.com/) personal-jazz-finder";

// --- /dj-show (Roon) -------------------------------------------------------

/**
 * Directory where node-roon-api persists the paired-core id and auth token, so re-runs don't
 * re-pair. Gitignored. Override with ROON_STATE_DIR (e.g. to share state across checkouts).
 */
export const roonStateDir = process.env.ROON_STATE_DIR || resolve(ROOT, "data/.roon-state");

/**
 * Directory the DJ MP3 clips are written to. MUST be (or map to) a Roon-watched Storage folder so
 * Roon indexes the clips and they can be queued. On a machine separate from the Core, point this
 * at a mounted share to that folder.
 */
export const djClipsDir = process.env.ROON_DJ_CLIPS_DIR || resolve(ROOT, "data/dj-clips");

/** Raw synthesized audio is cached here (NOT in the watched folder, so Roon doesn't index it). */
export const djClipCacheDir = resolve(ROOT, "data/.dj-clip-cache");

/** ID3 artist tag all DJ clips share, so they group in Roon and are findable by one search. */
export const DJ_CLIP_ARTIST = "Downbeat DJ";

/** Label recorded on the show manifest (the Roon API can't create a saved playlist by this name). */
export const ROON_PLAYLIST_NAME = process.env.ROON_PLAYLIST_NAME || "Downbeat — Late Night";

/**
 * Default Roon zone (display name or zone_id) the show is queued into. Optional: if unset and the
 * Core has exactly one zone, that zone is used; otherwise `dj:queue` lists the zones and asks for
 * --zone. Discover names with `downbeat roon:zones`.
 */
export const ROON_ZONE = process.env.ROON_ZONE || "";

/** ElevenLabs voice for the DJ. Default "Boe Deepman" — mellow late-night delivery. */
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "XFQFwy8OEb9lvFQIMZ5a";

/** ElevenLabs model id. eleven_multilingual_v2 is a good-quality default for narration. */
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

/**
 * Playback speed for the DJ voice (ElevenLabs voice_settings.speed, 0.7–1.2; <1 is slower).
 * Default 0.85 — a touch slow for a moody, late-night delivery.
 */
export const ELEVENLABS_SPEED = Number(process.env.ELEVENLABS_SPEED) || 0.85;

/**
 * Identity Roon shows the user under Settings → Extensions when pairing. The user enables
 * "Downbeat DJ" there once; the auth token then persists in roonStateDir.
 */
export const ROON_EXTENSION = {
  extension_id: "com.downbeat.dj",
  display_name: "Downbeat DJ",
  display_version: "0.1.0",
  publisher: "Downbeat",
  email: "downbeat@localhost",
} as const;
