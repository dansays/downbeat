import { requireEnv, USER_AGENT } from "./config.ts";
import type { Release } from "./types.ts";

const API = "https://api.discogs.com";

interface DiscogsArtist {
  name: string;
}
interface DiscogsFormat {
  name: string;
}
interface DiscogsBasicInfo {
  title: string;
  year: number;
  artists: DiscogsArtist[];
  genres?: string[];
  styles?: string[];
  formats?: DiscogsFormat[];
}
interface DiscogsCollectionItem {
  basic_information: DiscogsBasicInfo;
}
interface DiscogsCollectionPage {
  pagination: { page: number; pages: number };
  releases: DiscogsCollectionItem[];
}

/**
 * Fetch the user's entire collection (folder 0 = "All"), following pagination.
 * Returns releases normalized to the taste-relevant fields.
 */
export async function fetchCollection(): Promise<Release[]> {
  const username = requireEnv("DISCOGS_USERNAME");
  const token = requireEnv("DISCOGS_TOKEN");

  const releases: Release[] = [];
  let page = 1;
  let pages = 1;

  do {
    const url =
      `${API}/users/${encodeURIComponent(username)}/collection/folders/0/releases` +
      `?per_page=100&page=${page}&sort=artist`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Discogs token=${token}`,
        "User-Agent": USER_AGENT,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Discogs request failed (${res.status} ${res.statusText}) for ${username}. ${body.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as DiscogsCollectionPage;
    pages = data.pagination.pages;

    for (const item of data.releases) {
      const info = item.basic_information;
      releases.push({
        artists: (info.artists ?? []).map((a) => cleanArtist(a.name)),
        title: info.title,
        year: info.year || null,
        genres: info.genres ?? [],
        styles: info.styles ?? [],
        formats: (info.formats ?? []).map((f) => f.name),
      });
    }

    page += 1;
    // Be polite to Discogs' rate limit (60 req/min authenticated).
    if (page <= pages) await sleep(1100);
  } while (page <= pages);

  return releases;
}

/** Discogs disambiguates duplicate artist names with a "(2)" suffix; strip it. */
function cleanArtist(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
