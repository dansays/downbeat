import { requireEnv } from "./config.ts";

const API = "https://ws.audioscrobbler.com/2.0/";

export interface TopTrack {
  name: string;
  playcount: number;
}

interface LastfmTopTracksResponse {
  toptracks?: {
    track: Array<{ name: string; playcount: string }>;
  };
  error?: number;
  message?: string;
}

/**
 * Popular tracks for an artist, ordered by play count (most popular first).
 * We use Last.fm for this because Spotify removed its top-tracks endpoint in Feb 2026.
 */
export async function topTracks(artist: string, limit = 5): Promise<TopTrack[]> {
  const key = requireEnv("LASTFM_API_KEY");
  const url =
    `${API}?method=artist.gettoptracks&format=json&autocorrect=1` +
    `&artist=${encodeURIComponent(artist)}&api_key=${key}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Last.fm request failed (${res.status}) for "${artist}".`);
  }
  const data = (await res.json()) as LastfmTopTracksResponse;
  if (data.error) {
    throw new Error(`Last.fm error ${data.error} for "${artist}": ${data.message ?? ""}`);
  }

  const tracks = data.toptracks?.track ?? [];
  return tracks.slice(0, limit).map((t) => ({
    name: t.name,
    playcount: Number(t.playcount) || 0,
  }));
}
