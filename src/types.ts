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
