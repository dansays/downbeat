import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import RoonApi from "node-roon-api";
import RoonApiStatus from "node-roon-api-status";
import RoonApiBrowse from "node-roon-api-browse";
import { ROON_EXTENSION, roonStateDir } from "./config.ts";

/**
 * Roon integration for /dj-show. One concern per module (like lastfm.ts/todoist.ts): connect to
 * the Core, search Qobuz tracks, and build an ordered playlist via the Browse "Add to Playlist"
 * action. We never select a zone or control transport — this only assembles a playlist.
 *
 * The node-roon-api is event/callback based and meant to run as a long-lived extension. `withRoon`
 * adapts it to one-shot CLI use: start discovery, wait for pairing, run the work, disconnect.
 *
 * NOTE: Roon Browse `item_key`s are session-scoped — a key is only valid within the live browse
 * session that produced it. They do NOT survive across CLI processes, so callers must resolve a
 * track and add it to the playlist within the *same* `withRoon` session.
 */

/** What the work function receives: the live browse service for the paired Core. */
export interface RoonCtx {
  browse: any; // RoonApiBrowse instance (untyped lib; see roon.d.ts)
}

const HIERARCHY = "search"; // all our browsing happens in the search hierarchy
const STATE_FILE = resolve(roonStateDir, "roon-state.json");

/** Persist pairing state (paired_core_id + per-core tokens) to the gitignored state dir. */
function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(state: Record<string, unknown>): void {
  mkdirSync(roonStateDir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Connect to the Roon Core, wait for pairing, run `fn`, then disconnect. Rejects with an
 * actionable message if no paired Core appears within `timeoutMs` (the user must enable the
 * extension once in Roon → Settings → Extensions).
 */
export async function withRoon<T>(fn: (ctx: RoonCtx) => Promise<T>, timeoutMs = 15000): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const roon = new RoonApi({
      ...ROON_EXTENSION,
      get_persisted_state: () => loadState(),
      set_persisted_state: (state: Record<string, unknown>) => saveState(state),
      log_level: "none",
      core_paired: async (core: any) => {
        if (settled) return; // ignore a re-pair after we've already started/finished
        settled = true;
        if (timer) clearTimeout(timer);
        const browse = core.services.RoonApiBrowse;
        try {
          const result = await fn({ browse });
          cleanup();
          resolvePromise(result);
        } catch (err) {
          cleanup();
          rejectPromise(err instanceof Error ? err : new Error(String(err)));
        }
      },
      // Required by node-roon-api whenever core_paired is set. A mid-run unpair leaves the in-flight
      // work to fail on its next browse call, which surfaces as a normal rejection.
      core_unpaired: () => {},
    });

    const svcStatus = new RoonApiStatus(roon);

    function cleanup(): void {
      try {
        svcStatus.set_status("Idle", false);
        roon.stop_discovery();
        roon.disconnect_all();
      } catch {
        // best-effort teardown
      }
    }

    roon.init_services({
      required_services: [RoonApiBrowse],
      provided_services: [svcStatus],
    });
    svcStatus.set_status("Ready to build a playlist", false);
    roon.start_discovery();

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(
        new Error(
          "No paired Roon Core found. Open Roon → Settings → Extensions, enable " +
            `"${ROON_EXTENSION.display_name}", then re-run. (Roon and this machine must be on the ` +
            "same network.)",
        ),
      );
    }, timeoutMs);
  });
}

/** Promisified Browse#browse. */
function browseAsync(browse: any, opts: Record<string, unknown>): Promise<any> {
  return new Promise((res, rej) => {
    browse.browse({ hierarchy: HIERARCHY, ...opts }, (err: string | false, body: any) => {
      if (err) rej(new Error(`Roon browse failed: ${err}`));
      else res(body);
    });
  });
}

/** Promisified Browse#load. */
function loadAsync(browse: any, opts: Record<string, unknown> = {}): Promise<any> {
  return new Promise((res, rej) => {
    browse.load({ hierarchy: HIERARCHY, ...opts }, (err: string | false, body: any) => {
      if (err) rej(new Error(`Roon load failed: ${err}`));
      else res(body);
    });
  });
}

/** Load the current browse level's items. */
async function loadItems(browse: any): Promise<any[]> {
  const body = await loadAsync(browse);
  return (body?.items ?? []) as any[];
}

/** First item whose title contains `needle` (case-insensitive), or undefined. */
function findItem(items: any[], needle: string): any | undefined {
  const n = needle.toLowerCase();
  return items.find((it) => String(it.title ?? "").toLowerCase().includes(n));
}

/** Comma-joined item titles, for actionable "not found" errors during the spike. */
function titlesOf(items: any[]): string {
  return items.map((it) => it.title).filter(Boolean).join(", ") || "(none)";
}

export interface TrackHit {
  itemKey: string;
  matchedArtist: string;
  matchedTitle: string;
  source?: string;
}

/**
 * Search the Core for a track and return the first hit matching the artist. Leaves the browse
 * session positioned on the chosen track's level, so `addToPlaylist` can act on the returned
 * item_key within the same session.
 */
export async function searchTrack(
  browse: any,
  artist: string,
  title: string,
): Promise<TrackHit | null> {
  // Fresh search from the root of the hierarchy.
  await browseAsync(browse, { input: `${artist} ${title}`, pop_all: true });
  const topItems = await loadItems(browse);

  // Search results are grouped into categories; drill into Tracks.
  const tracksCategory = findItem(topItems, "Tracks");
  if (!tracksCategory?.item_key) return null;
  await browseAsync(browse, { item_key: tracksCategory.item_key });
  const trackItems = await loadItems(browse);
  if (trackItems.length === 0) return null;

  // Prefer a track whose subtitle (the artist line) matches; else take the first hit. With Qobuz
  // as the only source, the first hit is reliably Qobuz — but we still surface the source.
  const wantArtist = artist.toLowerCase();
  const match =
    trackItems.find((it) => String(it.subtitle ?? "").toLowerCase().includes(wantArtist)) ??
    trackItems[0];
  if (!match?.item_key) return null;

  return {
    itemKey: match.item_key,
    matchedTitle: String(match.title ?? title),
    matchedArtist: String(match.subtitle ?? artist),
    source: typeof match.hint === "string" ? match.hint : undefined,
  };
}

/**
 * Add the track identified by `trackItemKey` to a named playlist, creating it on the first add and
 * appending on subsequent adds. Must be called in the same browse session that produced the key.
 *
 * The action path is: track → action list → "Add to Playlist" → choose "New Playlist" (naming it
 * via the input prompt) or an existing playlist by name. The exact action titles and the
 * input-prompt handshake are Roon's; this is the load-bearing flow the Phase 0 spike validates,
 * and the "available: …" errors below make mismatches debuggable.
 */
export async function addToPlaylist(
  browse: any,
  trackItemKey: string,
  playlistName: string,
  opts: { create: boolean },
): Promise<void> {
  // Drill into the track's action list.
  await browseAsync(browse, { item_key: trackItemKey });
  const actions = await loadItems(browse);
  const addAction = findItem(actions, "Add to Playlist") ?? findItem(actions, "Playlist");
  if (!addAction?.item_key) {
    throw new Error(`No "Add to Playlist" action for this track. Available: ${titlesOf(actions)}`);
  }

  // Drill into Add-to-Playlist: a list of existing playlists plus a "New Playlist" entry.
  await browseAsync(browse, { item_key: addAction.item_key });
  const choices = await loadItems(browse);

  if (opts.create) {
    const newEntry = findItem(choices, "New Playlist") ?? findItem(choices, "New");
    if (!newEntry?.item_key) {
      throw new Error(`No "New Playlist" option. Available: ${titlesOf(choices)}`);
    }
    // Selecting "New Playlist" prompts for a name; supply it as the browse input.
    const body = await browseAsync(browse, { item_key: newEntry.item_key, input: playlistName });
    assertNotError(body, `create playlist "${playlistName}"`);
  } else {
    const existing = findItem(choices, playlistName);
    if (!existing?.item_key) {
      throw new Error(
        `Playlist "${playlistName}" not found to append to. Available: ${titlesOf(choices)}`,
      );
    }
    const body = await browseAsync(browse, { item_key: existing.item_key });
    assertNotError(body, `append to playlist "${playlistName}"`);
  }
}

/** Throw if a browse response came back as an error message. */
function assertNotError(body: any, what: string): void {
  if (body?.action === "message" && body?.is_error) {
    throw new Error(`Roon rejected ${what}: ${body.message ?? "unknown error"}`);
  }
}
