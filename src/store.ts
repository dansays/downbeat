import { readFile, writeFile } from "node:fs/promises";
import { PATHS } from "./config.ts";
import type { SeenEvent, PlaylistState } from "./types.ts";

/** Stable dedup key for an event. */
export function eventKey(venue: string, date: string, artist: string): string {
  return `${venue}|${date}|${artist}`.toLowerCase().trim();
}

/** Load the dedup ledger, tolerating a missing or empty file. */
export async function loadSeen(): Promise<SeenEvent[]> {
  try {
    const raw = await readFile(PATHS.seen, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed) as SeenEvent[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function saveSeen(events: SeenEvent[]): Promise<void> {
  await writeFile(PATHS.seen, JSON.stringify(events, null, 2) + "\n", "utf8");
}

/** True if this event was already pushed to Todoist. */
export async function isSeen(key: string): Promise<boolean> {
  const seen = await loadSeen();
  return seen.some((e) => e.key === key);
}

/** Append an event to the ledger (no-op if already present). */
export async function markSeen(entry: Omit<SeenEvent, "addedAt">): Promise<void> {
  const seen = await loadSeen();
  if (seen.some((e) => e.key === entry.key)) return;
  seen.push({ ...entry, addedAt: new Date().toISOString() });
  await saveSeen(seen);
}

/** Read the raw venues markdown (the scan command parses this itself). */
export async function readVenues(): Promise<string> {
  return readFile(PATHS.venues, "utf8");
}

/** Load the playlist state, tolerating a missing or empty file. */
export async function loadPlaylist(): Promise<PlaylistState> {
  try {
    const raw = (await readFile(PATHS.playlist, "utf8")).trim();
    if (!raw) return { tracks: [] };
    return JSON.parse(raw) as PlaylistState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { tracks: [] };
    throw err;
  }
}

export async function savePlaylist(state: PlaylistState): Promise<void> {
  await writeFile(PATHS.playlist, JSON.stringify(state, null, 2) + "\n", "utf8");
}
