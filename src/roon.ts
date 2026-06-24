import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import RoonApi from "node-roon-api";
import RoonApiStatus from "node-roon-api-status";
import RoonApiBrowse from "node-roon-api-browse";
import RoonApiTransport from "node-roon-api-transport";
import { ROON_EXTENSION, roonStateDir } from "./config.ts";

/**
 * Roon integration for /dj-show. One concern per module (like lastfm.ts/todoist.ts): connect to
 * the Core, search Qobuz tracks, and load an ordered show into a Roon zone's play queue.
 *
 * Why a queue and not a saved playlist: a Phase-0 spike showed the community Browse API exposes
 * only transport actions (Play Now / Add Next / Queue / Start Radio) on tracks — reached via
 * search, library, OR an existing playlist. It has NO "Add to Playlist"/"Add to Library" action,
 * so it cannot create or edit a saved playlist. Queueing to a zone is the only way to assemble an
 * ordered show, and the only path that can later interleave local DJ clips (Phase 2).
 *
 * The node-roon-api is event/callback based and meant to run as a long-lived extension. `withRoon`
 * adapts it to one-shot CLI use: start discovery, wait for pairing, run the work, disconnect.
 *
 * NOTE: Roon Browse `item_key`s are session-scoped — a key is only valid within the live browse
 * session that produced it. They do NOT survive across CLI processes, so callers must resolve a
 * track and queue it within the *same* `withRoon` session.
 */

/** What the work function receives: the live browse + transport services for the paired Core. */
export interface RoonCtx {
  browse: any; // RoonApiBrowse instance (untyped lib; see roon-api-shim.d.ts)
  transport: any; // RoonApiTransport instance
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
export async function withRoon<T>(fn: (ctx: RoonCtx) => Promise<T>, timeoutMs = 30000): Promise<T> {
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
        const transport = core.services.RoonApiTransport;
        try {
          const result = await fn({ browse, transport });
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
      required_services: [RoonApiBrowse, RoonApiTransport],
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
  score?: number; // ranking score of the chosen candidate (debug/visibility)
}

/** Normalize for comparison: lowercase, collapse punctuation/whitespace. */
function norm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Title qualifiers that mark an alternate/non-canonical take. Penalized unless the request itself
// asked for them, so the plain studio recording wins over live/remaster/alternate versions.
const QUALIFIER = /\b(live|take|alternate|reprise|remaster|remastered|version|mix|edit|outtake|interlude|suite|demo|mono|stereo|instrumental|karaoke|radio)\b/;

/**
 * Score a track result against the wanted artist/title. Higher is better. Rewards the wanted artist
 * being the *lead* credit (not a guest), an exact title, and penalizes alternate-take qualifiers.
 * Returns -1 if the wanted artist isn't credited at all (not a real candidate).
 */
function scoreTrack(item: any, artist: string, title: string): number {
  const nA = norm(artist);
  const subRaw = String(item.subtitle ?? "");
  const nSub = norm(subRaw);
  if (!nSub.includes(nA)) return -1; // artist not credited — reject

  let score = 0;
  // Artist primacy: is the wanted artist the first credited name (their own recording), vs a guest?
  const firstCredit = norm(subRaw.split(/[,/&]/)[0] ?? "");
  if (firstCredit === nA) score += 100; // exact lead (e.g. "Bill Evans")
  else if (firstCredit.startsWith(nA)) score += 80; // lead is the artist's group ("Bill Evans Trio")
  else score += 30; // credited but a guest (e.g. "Tony Bennett, Bill Evans, …")

  // Title closeness.
  const nT = norm(item.title);
  const nWant = norm(title);
  if (nT === nWant) score += 40;
  else if (nT.startsWith(nWant)) score += 15;
  else if (nT.includes(nWant)) score += 5;

  // Penalize alternate-take qualifiers unless the request asked for them.
  if (nT !== nWant && QUALIFIER.test(nT) && !QUALIFIER.test(nWant)) score -= 20;

  // Mild preference for the tightest title (fewer extra words).
  score -= Math.max(0, nT.length - nWant.length) * 0.05;
  return score;
}

/** Rank track results best-first; ties keep Roon's original order. */
export function rankTracks(items: any[], artist: string, title: string): Array<{ item: any; score: number }> {
  return items
    .map((item, i) => ({ item, score: scoreTrack(item, artist, title), i }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ item, score }) => ({ item, score }));
}

/**
 * Search the Core for a track and return the best-scoring artist match. Leaves the browse session
 * positioned on the chosen track's level, so `queueTrack` can act on the returned item_key within
 * the same session. `onCandidates` (optional) receives the ranked list for debugging/visibility.
 */
export async function searchTrack(
  browse: any,
  artist: string,
  title: string,
  onCandidates?: (ranked: Array<{ item: any; score: number }>) => void,
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

  const ranked = rankTracks(trackItems, artist, title);
  if (onCandidates) onCandidates(ranked);
  // Best artist-credited match; if none credit the artist, fall back to Roon's top track hit.
  const best = ranked[0]?.item ?? trackItems[0];
  if (!best?.item_key) return null;

  return {
    itemKey: best.item_key,
    matchedTitle: String(best.title ?? title),
    matchedArtist: String(best.subtitle ?? artist),
    source: typeof best.hint === "string" ? best.hint : undefined,
    score: ranked[0]?.score,
  };
}

export interface Zone {
  zoneId: string;
  name: string;
}

/** List the Core's playback zones (display name + id) for the user to target. */
export function listZones(transport: any): Promise<Zone[]> {
  return new Promise((res, rej) => {
    transport.get_zones((err: string | false, body: any) => {
      if (err) rej(new Error(`Roon get_zones failed: ${err}`));
      else res(((body?.zones ?? []) as any[]).map((z) => ({ zoneId: z.zone_id, name: z.display_name })));
    });
  });
}

/**
 * Queue the track identified by `trackItemKey` into a zone. `mode: "playNow"` replaces the zone's
 * queue with this track and starts playback (use for the first track of the show); `mode: "queue"`
 * appends to the end (use for the rest), so the show plays through in order. Must be called in the
 * same browse session that produced the key.
 *
 * The action path is: track → (one-item wrapper) → action list → "Play Now"/"Queue". Every browse
 * carries the zone, since these are transport actions. The "available: …" error makes any future
 * action-title drift debuggable.
 */
export async function queueTrack(
  browse: any,
  trackItemKey: string,
  zoneId: string,
  mode: "playNow" | "queue",
): Promise<void> {
  // Drill into the track. Roon wraps the action list one level deep (a single action_list item
  // titled like the track), so descend through that wrapper to reach the real actions.
  await browseAsync(browse, { item_key: trackItemKey, zone_or_output_id: zoneId });
  let items = await loadItems(browse);
  if (items.length === 1 && items[0]?.item_key && items[0]?.hint === "action_list") {
    await browseAsync(browse, { item_key: items[0].item_key, zone_or_output_id: zoneId });
    items = await loadItems(browse);
  }

  const wanted = mode === "playNow" ? "Play Now" : "Queue";
  const action = findItem(items, wanted);
  if (!action?.item_key) {
    throw new Error(`No "${wanted}" action for this track. Available: ${titlesOf(items)}`);
  }
  const body = await browseAsync(browse, { item_key: action.item_key, zone_or_output_id: zoneId });
  assertNotError(body, wanted);
}

/** Throw if a browse response came back as an error message. */
function assertNotError(body: any, what: string): void {
  if (body?.action === "message" && body?.is_error) {
    throw new Error(`Roon rejected ${what}: ${body.message ?? "unknown error"}`);
  }
}
