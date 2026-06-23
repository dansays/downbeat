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
