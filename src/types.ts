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
