import { readFile, writeFile } from "node:fs/promises";
import { PATHS } from "./config.ts";
import type { SeenEvent, PlaylistState, DjShow } from "./types.ts";

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

/** True if this event was already recorded in the dedup ledger. */
export async function isSeen(key: string): Promise<boolean> {
  const seen = await loadSeen();
  return seen.some((e) => e.key === key);
}

/**
 * Append an event to the ledger, or — if the key already exists — backfill any enrichment
 * (time/ticketUrl/description) that a later scan provides but the stored entry is missing. The
 * dedup key and original `addedAt` are preserved, so this never creates duplicates.
 */
export async function markSeen(entry: Omit<SeenEvent, "addedAt">): Promise<void> {
  const seen = await loadSeen();
  const existing = seen.find((e) => e.key === entry.key);
  if (existing) {
    let changed = false;
    for (const field of ["time", "ticketUrl", "description"] as const) {
      if (entry[field] && !existing[field]) {
        existing[field] = entry[field];
        changed = true;
      }
    }
    if (changed) await saveSeen(seen);
    return;
  }
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

/** Load the DJ-show manifest, tolerating a missing or empty file. */
export async function loadDjShow(): Promise<DjShow> {
  try {
    const raw = (await readFile(PATHS.djShow, "utf8")).trim();
    if (!raw) return { generatedAt: "", segments: [] };
    return JSON.parse(raw) as DjShow;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { generatedAt: "", segments: [] };
    throw err;
  }
}

export async function saveDjShow(show: DjShow): Promise<void> {
  await writeFile(PATHS.djShow, JSON.stringify(show, null, 2) + "\n", "utf8");
}
