import { readFile, writeFile } from "node:fs/promises";
import { PATHS } from "./config.ts";
import { topTracks } from "./lastfm.ts";
import type { SeenEvent } from "./types.ts";

/**
 * Build-time artist enrichment for the show page: album art + an Apple Music artist link from the
 * free iTunes Search API, and suggested songs from Last.fm. Results are cached (gitignored) so
 * rebuilds are cheap and offline rebuilds still render — enrichment is decoration, never a
 * hard dependency: any lookup failure degrades to a plain card.
 */

export interface ArtistEnrichment {
  /** ~400x400 album/cover art URL from the iTunes Search API. */
  artworkUrl?: string;
  /** Direct Apple Music artist page, when iTunes matched the artist. */
  appleMusicArtistUrl?: string;
  /** Suggested song titles (Last.fm top tracks, most popular first). */
  songs?: string[];
  /** The cleaned name variant the lookups matched on — use it for song search links. */
  searchArtist?: string;
  fetchedAt: string; // ISO timestamp, drives the cache TTL
}

const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // re-lookup after two weeks
const ITUNES_DELAY_MS = 3000; // iTunes Search API allows ~20 calls/minute
const LASTFM_DELAY_MS = 250;
const SONGS_PER_ARTIST = 3;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Lowercase, strip diacritics and non-alphanumerics — loose comparison form. */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Progressively simpler search variants for a billed name: strip parentheticals, "feat./with …"
 * tails, "and his/her/their …" ensembles, possessive projects ("X's Big Band" → "X"), trailing
 * ensemble words, and finally anything after an "&". Order matters — most specific first.
 */
export function artistVariants(artist: string): string[] {
  const out: string[] = [];
  const push = (s: string): void => {
    const t = s.replace(/\s{2,}/g, " ").trim();
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  let s = artist.trim();
  push(s);
  s = s.replace(/\s*\([^)]*\)\s*/g, " ");
  s = s.replace(/\s+[-–—]\s+.+$/, ""); // "Anne Walsh - Bossa to Bacharach" → "Anne Walsh"
  push(s);
  s = s.replace(/\s+(feat\.?|featuring|ft\.?)\s+.+$/i, "");
  s = s.replace(/\s+(duo|trio|quartet|quintet)?\s*with\s+.+$/i, "");
  push(s);
  s = s.replace(/\s+(and|&)\s+(his|her|their)\s+.+$/i, "");
  push(s);
  const possessive = s.match(/^(.{3,}?)['’]s\s+.+$/);
  if (possessive?.[1]) push(possessive[1]);
  s = possessive?.[1] ?? s;
  s = s.replace(/\s+(big band|trio|quartet|quintet|sextet|septet|octet|band|orchestra|group|collective|ensemble|all-?stars)$/i, "");
  push(s);
  const beforeAmp = s.split(/\s+&\s+|\s+and\s+/i)[0];
  if (beforeAmp) push(beforeAmp);
  return out;
}

// --- iTunes Search API -------------------------------------------------------

interface ItunesResult {
  wrapperType?: string; // "artist" | "collection" | "track"
  artistId?: number;
  artistName?: string;
  artistLinkUrl?: string; // artist page (on wrapperType "artist" results)
  artistViewUrl?: string; // artist page (on album/track results)
  artworkUrl100?: string;
  primaryGenreName?: string;
}

/** One throttled iTunes API call; retries once on rate-limit, returns [] on any failure. */
async function itunesCall(pathAndQuery: string): Promise<ItunesResult[]> {
  const url = `https://itunes.apple.com/${pathAndQuery}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 403 || res.status === 429) {
        await sleep(20000); // rate-limited: back off once, then give up
        continue;
      }
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: ItunesResult[] };
      await sleep(ITUNES_DELAY_MS);
      return data.results ?? [];
    } catch {
      return []; // offline or DNS failure — degrade to a plain card
    }
  }
  return [];
}

/**
 * Genres we trust when a *stripped* name variant matches. The full billed name is specific enough
 * to trust any genre, but short variants ("Sylvia") collide with unrelated famous artists — for
 * those, only jazz-adjacent catalog counts as confirmation it's the right person.
 */
const JAZZY_GENRE =
  /jazz|vocal|big band|bossa|swing|standards|easy listening|blues|latin|instrumental|holiday|christmas|world|soundtrack|stage|cabaret/i;
const genreOk = (g: string | undefined, strict: boolean): boolean =>
  !strict || !g || JAZZY_GENRE.test(g);

/** Strict name equality for artist credits (leading "The" optional, diacritics/punct ignored). */
function sameArtist(a: string | undefined, variant: string): boolean {
  const na = norm(a ?? "");
  const nv = norm(variant);
  if (!na || !nv) return false;
  return na === nv || na === `the ${nv}` || nv === `the ${na}`;
}

/**
 * Find art + an artist page for one of the name variants; undefined fields when nothing matches.
 *
 * Pass 1 resolves the artist by exact name (entity=musicArtist), then takes art only from that
 * artist's own albums — a side credit on someone else's record ("… feat. Roy McCurdy") can no
 * longer donate the wrong face and profile link. Pass 2 is a fallback album search that accepts
 * only a lead credit. Stripped variants additionally require jazz-adjacent genre (see JAZZY_GENRE).
 */
async function itunesLookup(
  variants: string[],
): Promise<{ artworkUrl?: string; appleMusicArtistUrl?: string; searchArtist?: string }> {
  // Pass 1: exact artist resolution. Cap at 4 variants so unmatchable names stay cheap.
  for (const [i, variant] of variants.slice(0, 4).entries()) {
    const strict = i > 0; // stripped variants are ambiguous → require jazz-adjacent genre
    const artists = await itunesCall(
      `search?media=music&entity=musicArtist&limit=10&term=${encodeURIComponent(variant)}`,
    );
    const artist = artists.find(
      (r) => sameArtist(r.artistName, variant) && genreOk(r.primaryGenreName, strict),
    );
    if (!artist?.artistId) continue;
    const looked = await itunesCall(`lookup?id=${artist.artistId}&entity=album&limit=8`);
    // The lookup returns every collection credited to the artistId, including other leaders'
    // albums they played on — only accept albums where THEY are the lead credit, so a sideman's
    // card never wears someone else's cover.
    const leadName = artist.artistName ?? variant;
    const album = looked.find(
      (r) =>
        r.wrapperType === "collection" &&
        r.artworkUrl100 &&
        genreOk(r.primaryGenreName, strict) &&
        (sameArtist(r.artistName, leadName) ||
          norm(r.artistName ?? "").startsWith(`${norm(leadName)} `)),
    );
    return {
      artworkUrl: album?.artworkUrl100?.replace(/100x100bb/, "400x400bb"),
      appleMusicArtistUrl: artist.artistLinkUrl,
      searchArtist: variant,
    };
  }

  // Pass 2: no artist record — fall back to albums where the *lead credit* is the name itself.
  for (const [i, variant] of variants.slice(0, 2).entries()) {
    const strict = i > 0;
    const results = await itunesCall(
      `search?media=music&entity=album&limit=8&term=${encodeURIComponent(variant)}`,
    );
    const hit = results.find(
      (r) =>
        r.artworkUrl100 &&
        genreOk(r.primaryGenreName, strict) &&
        (sameArtist(r.artistName, variant) ||
          norm(r.artistName ?? "").startsWith(`${norm(variant)} `)),
    );
    if (hit?.artworkUrl100) {
      return {
        artworkUrl: hit.artworkUrl100.replace(/100x100bb/, "400x400bb"),
        appleMusicArtistUrl: hit.artistViewUrl,
        searchArtist: variant,
      };
    }
  }
  return {};
}

// --- cache -------------------------------------------------------------------

type EnrichmentCache = Record<string, ArtistEnrichment>;

async function loadCache(): Promise<EnrichmentCache> {
  try {
    return JSON.parse(await readFile(PATHS.pageCache, "utf8")) as EnrichmentCache;
  } catch {
    return {};
  }
}

async function saveCache(cache: EnrichmentCache): Promise<void> {
  await writeFile(PATHS.pageCache, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

// --- entry point ---------------------------------------------------------------

/**
 * Enrich every distinct artist in `events`, reading/writing the cache as it goes. Progress is
 * logged to stderr because first runs pace themselves against the iTunes rate limit (~3s/call).
 */
export async function enrichArtists(events: SeenEvent[]): Promise<Map<string, ArtistEnrichment>> {
  const cache = await loadCache();
  const now = Date.now();
  const artists = [...new Set(events.map((e) => e.artist))];
  const result = new Map<string, ArtistEnrichment>();
  const stale = artists.filter((a) => {
    const hit = cache[a.toLowerCase()];
    return !hit || now - Date.parse(hit.fetchedAt) > CACHE_TTL_MS;
  });
  if (stale.length) {
    console.error(
      `Enriching ${stale.length} of ${artists.length} artist(s) (art via iTunes, songs via ` +
        `Last.fm; paced ~${ITUNES_DELAY_MS / 1000}s/call for the iTunes rate limit)…`,
    );
  }

  let done = 0;
  for (const artist of artists) {
    const key = artist.toLowerCase();
    const cached = cache[key];
    if (cached && now - Date.parse(cached.fetchedAt) <= CACHE_TTL_MS) {
      result.set(artist, cached);
      continue;
    }

    const variants = artistVariants(artist);
    const art = await itunesLookup(variants);

    let songs: string[] | undefined;
    let songArtist: string | undefined;
    for (const variant of variants) {
      try {
        const top = await topTracks(variant, SONGS_PER_ARTIST);
        await sleep(LASTFM_DELAY_MS);
        // Last.fm invents empty lists rather than erroring for unknowns; only keep real hits.
        if (top.length && top.some((t) => t.playcount > 0)) {
          songs = top.map((t) => t.name);
          songArtist = variant;
          break;
        }
      } catch {
        break; // no key or network trouble — skip songs for everyone quickly
      }
    }

    const entry: ArtistEnrichment = {
      ...art,
      songs,
      searchArtist: songArtist ?? art.searchArtist,
      fetchedAt: new Date().toISOString(),
    };
    cache[key] = entry;
    result.set(artist, entry);
    done++;
    if (done % 5 === 0 || done === stale.length) {
      console.error(`  …${done}/${stale.length} looked up`);
      await saveCache(cache); // checkpoint so an interrupted run keeps its progress
    }
  }

  await saveCache(cache);
  return result;
}
