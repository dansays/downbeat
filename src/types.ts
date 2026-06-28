/** A release normalized from the Discogs collection, trimmed to taste-relevant fields. */
export interface Release {
  artists: string[];
  title: string;
  year: number | null;
  genres: string[];
  styles: string[];
  formats: string[];
}

/** An entry in the dedup ledger for a matched show already recorded. */
export interface SeenEvent {
  key: string; // `${venue}|${date}|${artist}` lowercased
  venue: string;
  date: string; // YYYY-MM-DD
  artist: string;
  time?: string; // "HH:MM" 24h, America/Los_Angeles; omitted ⇒ all-day calendar event
  ticketUrl?: string; // ticket/info link for the show
  description?: string; // one–two sentence "why it matches" rationale, for the calendar
  addedAt: string; // ISO timestamp
  taskId?: string; // legacy field present in older ledger entries
}

/** A song on the listen-ahead list, tied to the show that put it there. */
export interface PlaylistTrack {
  title: string;
  artist: string; // normalized lookup artist
  billedArtist: string; // how the act was billed at the venue
  venue: string;
  showDate: string; // YYYY-MM-DD — used to prune after the show passes
  appleMusicUrl: string; // tap-to-add search link
  addedAt: string; // ISO timestamp
}

/** Persisted state for the listen-ahead list (source of truth for dedup + prune). */
export interface PlaylistState {
  tracks: PlaylistTrack[];
}

/** One upcoming matched act to sync, produced by /sync-playlist and piped to playlist:sync. */
export interface SyncArtist {
  artist: string; // normalized lookup artist (e.g. "Amanda Castro")
  billedArtist: string; // venue billing (e.g. "The Amanda Castro Band")
  venue: string;
  showDate: string; // YYYY-MM-DD
}

// --- /dj-show ---------------------------------------------------------------

/** One curated act in the show spec piped to `dj:resolve` (produced by the /dj-show skill). */
export interface ShowSpecArtist {
  artist: string; // normalized recording artist used for the Roon search
  billedArtist: string; // how the act is billed at the venue (spoken by the DJ)
  venue: string;
  showDate: string; // YYYY-MM-DD
  whyItMatches?: string; // rationale carried from the scan, grounds the DJ script in Phase 2
  tracks: string[]; // curated track titles, in intended play order
}

/** A track resolved to a Roon/Qobuz library item by `dj:resolve`. */
export interface ResolvedTrack {
  artist: string; // normalized recording artist (from the spec)
  billedArtist: string;
  title: string; // requested title
  itemKey: string; // Roon Browse item_key for "Add to Playlist"
  matchedArtist: string; // artist text Roon actually matched
  matchedTitle: string; // title text Roon actually matched
  source?: string; // streaming source of the match (e.g. "Qobuz"), for sanity-checking
}

/**
 * A DJ commentary segment written by Claude, fed to `dj:tts`. `slot` is the show position;
 * `artistKey` (the billed name) ties an "artist" intro to that act so `dj:build` can interleave it.
 */
export interface ScriptSegment {
  slot: "intro" | "artist" | "outro";
  text: string; // what Stephen Holloway says
  artistKey?: string; // billedArtist this intro precedes (for slot:"artist")
}

/** A synthesized DJ clip produced by `dj:tts` (MP3 in the Roon-watched clips dir). */
export interface DjClip {
  slot: "intro" | "artist" | "outro";
  artistKey?: string;
  title: string; // searchable title Roon indexes the clip under
  path: string; // local file path of the MP3
  hash: string; // cache key (text+voice+model)
}

/**
 * One element of the assembled show, in play order. The `clip` variant is declared for the
 * forthcoming DJ-commentary phase (Phase 2); the music-only pipeline emits only `track` segments.
 */
export type ShowSegment =
  | {
      kind: "track";
      itemKey: string;
      artist: string;
      billedArtist: string;
      title: string; // matched title, for display
      reqTitle: string; // originally requested title, for stable re-resolution at queue time
    }
  | {
      kind: "clip";
      slot: "intro" | "artist" | "outro";
      title: string; // clip title used to find it in Roon Browse
      path?: string; // local file path of the synthesized MP3
    };

/** The source-of-truth manifest written to data/dj-show.json. */
export interface DjShow {
  generatedAt: string; // ISO timestamp
  playlistName?: string; // Roon playlist this builds into
  segments: ShowSegment[];
}
