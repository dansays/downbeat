/**
 * Search-URL links for an artist. Neither Apple Music nor AllMusic offers a free
 * "exact artist page" lookup, so we link to a pre-filled search instead.
 */
export function artistLinks(artist: string): { appleMusic: string; allMusic: string } {
  const apple = encodeURIComponent(artist);
  // AllMusic's search path expects the query in the path segment.
  const am = encodeURIComponent(artist);
  return {
    appleMusic: `https://music.apple.com/us/search?term=${apple}`,
    allMusic: `https://www.allmusic.com/search/artists/${am}`,
  };
}

/**
 * Apple Music search link for a specific song, pre-filled with "artist title" so the track
 * is the top hit. Tap it in Apple Music, then add the song to a playlist/library.
 */
export function songLink(artist: string, title: string): string {
  return `https://music.apple.com/us/search?term=${encodeURIComponent(`${artist} ${title}`)}`;
}
