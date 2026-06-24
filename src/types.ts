/** A release normalized from the Discogs collection, trimmed to taste-relevant fields. */
export interface Release {
  artists: string[];
  title: string;
  year: number | null;
  genres: string[];
  styles: string[];
  formats: string[];
}

/** An entry in the dedup ledger for a show already pushed to Todoist. */
export interface SeenEvent {
  key: string; // `${venue}|${date}|${artist}` lowercased
  venue: string;
  date: string; // YYYY-MM-DD
  artist: string;
  taskId?: string;
  addedAt: string; // ISO timestamp
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
 * One element of the assembled show, in play order. The `clip` variant is declared for the
 * forthcoming DJ-commentary phase (Phase 2); the music-only pipeline emits only `track` segments.
 */
export type ShowSegment =
  | {
      kind: "track";
      itemKey: string;
      artist: string;
      billedArtist: string;
      title: string;
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

/** Payload accepted by the `todoist:add` command (single or array via stdin). */
export interface TaskInput {
  content: string;
  description?: string;
  due_date?: string; // YYYY-MM-DD
  project_id?: string;
  // Optional dedup metadata; recorded in the ledger when present.
  venue?: string;
  date?: string;
  artist?: string;
}
