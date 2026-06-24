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
 * Directory the DJ MP3 clips are written to. This must be a Roon-watched folder for the clips to
 * be addable to a playlist. Used in Phase 2 (clips/TTS); unused by the music-only pipeline.
 */
export const djClipsDir = process.env.ROON_DJ_CLIPS_DIR || resolve(ROOT, "data/dj-clips");

/** Label recorded on the show manifest (the Roon API can't create a saved playlist by this name). */
export const ROON_PLAYLIST_NAME = process.env.ROON_PLAYLIST_NAME || "Downbeat — Late Night";

/**
 * Default Roon zone (display name or zone_id) the show is queued into. Optional: if unset and the
 * Core has exactly one zone, that zone is used; otherwise `dj:queue` lists the zones and asks for
 * --zone. Discover names with `downbeat roon:zones`.
 */
export const ROON_ZONE = process.env.ROON_ZONE || "";

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
