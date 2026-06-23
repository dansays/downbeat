#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { fetchCollection } from "./discogs.ts";
import { resolveProjectId, createTask } from "./todoist.ts";
import { eventKey, isSeen, markSeen, loadPlaylist, savePlaylist } from "./store.ts";
import { artistLinks, songLink } from "./links.ts";
import { topTracks } from "./lastfm.ts";
import { TODOIST_PROJECT, PATHS } from "./config.ts";
import type { TaskInput, SyncArtist, PlaylistTrack } from "./types.ts";

const program = new Command();
program
  .name("downbeat")
  .description("Find live jazz shows you'll like and file them as Todoist review tasks.");

/** Read all of stdin as a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

program
  .command("discogs:dump")
  .description("Fetch the full Discogs collection as normalized JSON (for taste analysis).")
  .action(async () => {
    try {
      const releases = await fetchCollection();
      process.stdout.write(JSON.stringify(releases, null, 2) + "\n");
      console.error(`Fetched ${releases.length} releases.`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("todoist:project")
  .description("Resolve (or create) a Todoist project by name and print its id.")
  .option("--name <name>", "project name", TODOIST_PROJECT)
  .action(async (opts: { name: string }) => {
    try {
      const id = await resolveProjectId(opts.name);
      console.log(id);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("todoist:add")
  .description("Create one or more tasks. Reads a JSON object or array from stdin.")
  .action(async () => {
    try {
      const raw = (await readStdin()).trim();
      if (!raw) throw new Error("No JSON provided on stdin.");
      const parsed = JSON.parse(raw) as TaskInput | TaskInput[];
      const tasks = Array.isArray(parsed) ? parsed : [parsed];

      // Resolve the default project once if any task omits a project_id.
      let defaultProject: string | undefined;
      if (tasks.some((t) => !t.project_id)) {
        defaultProject = await resolveProjectId(TODOIST_PROJECT);
      }

      for (const t of tasks) {
        const projectId = t.project_id ?? defaultProject;
        const taskId = await createTask({ ...t, project_id: projectId });
        console.log(`created ${taskId}: ${t.content}`);

        // Record in the dedup ledger when event metadata is present.
        if (t.venue && t.date && t.artist) {
          await markSeen({
            key: eventKey(t.venue, t.date, t.artist),
            venue: t.venue,
            date: t.date,
            artist: t.artist,
            taskId,
          });
        }
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command("seen:check")
  .description("Print 'seen' or 'new' for a given venue/date/artist.")
  .requiredOption("--venue <venue>")
  .requiredOption("--date <date>", "YYYY-MM-DD")
  .requiredOption("--artist <artist>")
  .action(async (opts: { venue: string; date: string; artist: string }) => {
    try {
      const key = eventKey(opts.venue, opts.date, opts.artist);
      console.log((await isSeen(key)) ? "seen" : "new");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("seen:add")
  .description("Record a venue/date/artist in the dedup ledger without creating a task.")
  .requiredOption("--venue <venue>")
  .requiredOption("--date <date>", "YYYY-MM-DD")
  .requiredOption("--artist <artist>")
  .action(async (opts: { venue: string; date: string; artist: string }) => {
    try {
      await markSeen({
        key: eventKey(opts.venue, opts.date, opts.artist),
        venue: opts.venue,
        date: opts.date,
        artist: opts.artist,
      });
      console.log("ok");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("links")
  .description("Print Apple Music and AllMusic search URLs for an artist.")
  .requiredOption("--artist <artist>")
  .action((opts: { artist: string }) => {
    const links = artistLinks(opts.artist);
    console.log(JSON.stringify(links, null, 2));
  });

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Identity of a synced show, for dedup against the playlist state. */
function showKey(artist: string, showDate: string, venue: string): string {
  return `${artist}|${showDate}|${venue}`.toLowerCase().trim();
}

program
  .command("lastfm:top")
  .description("Print an artist's most popular tracks (sanity check for the Last.fm key).")
  .requiredOption("--artist <artist>")
  .option("--limit <n>", "how many tracks", "5")
  .action(async (opts: { artist: string; limit: string }) => {
    try {
      const tracks = await topTracks(opts.artist, Number(opts.limit));
      console.log(JSON.stringify(tracks, null, 2));
    } catch (err) {
      fail(err);
    }
  });

/** Render the listen-ahead list as markdown, grouped by show and sorted by date. */
function renderPlaylistMd(tracks: PlaylistTrack[]): string {
  const shows = new Map<string, PlaylistTrack[]>();
  for (const t of tracks) {
    const key = `${t.showDate}|${t.billedArtist}|${t.venue}`;
    (shows.get(key) ?? shows.set(key, []).get(key)!).push(t);
  }
  const keys = [...shows.keys()].sort(); // showDate leads the key, so this sorts chronologically

  const lines: string[] = [
    "# Live in LA — Listen Ahead",
    "",
    "_Popular songs by jazz artists with upcoming LA shows. Regenerated by `/sync-playlist`._",
    "_Tap a song to open it in Apple Music, then add it to your playlist/library._",
    "",
  ];
  for (const key of keys) {
    const group = shows.get(key)!;
    const first = group[0]!;
    const [y, m, d] = first.showDate.split("-").map(Number);
    const when = new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    lines.push(`## ${first.billedArtist} @ ${first.venue} — ${when}`);
    for (const t of group) lines.push(`- [${t.title}](${t.appleMusicUrl})`);
    lines.push("");
  }
  if (keys.length === 0) lines.push("_No upcoming shows. Run `/scan-jazz`, then `/sync-playlist`._", "");
  return lines.join("\n");
}

program
  .command("playlist:build")
  .description(
    "Build the free Apple Music listen-ahead list from a JSON array of " +
      "{artist, billedArtist, venue, showDate} on stdin: prune past shows, add ~5 popular " +
      "songs per new upcoming artist, and (re)write data/playlist.md.",
  )
  .option("--songs <n>", "songs per artist", "5")
  .action(async (opts: { songs: string }) => {
    try {
      const raw = (await readStdin()).trim();
      if (!raw) throw new Error("No JSON provided on stdin.");
      const items = JSON.parse(raw) as SyncArtist[];
      const songsPerArtist = Number(opts.songs) || 5;

      const state = await loadPlaylist();
      const now = today();

      // 1) PRUNE songs whose show has passed.
      const before = state.tracks.length;
      state.tracks = state.tracks.filter((t) => t.showDate >= now);
      const prunedCount = before - state.tracks.length;

      // 2) ADD ~N popular songs per new upcoming show (skip shows already on the list).
      const syncedShows = new Set(state.tracks.map((t) => showKey(t.artist, t.showDate, t.venue)));
      const unresolved: string[] = [];
      let addedTrackCount = 0;
      let syncedArtists = 0;

      for (const item of items) {
        if (item.showDate < now) continue;
        const key = showKey(item.artist, item.showDate, item.venue);
        if (syncedShows.has(key)) continue;
        syncedShows.add(key);

        const popular = await topTracks(item.artist, songsPerArtist);
        if (popular.length === 0) {
          unresolved.push(`${item.artist} (${item.billedArtist})`);
          continue;
        }
        for (const t of popular) {
          state.tracks.push({
            title: t.name,
            artist: item.artist,
            billedArtist: item.billedArtist,
            venue: item.venue,
            showDate: item.showDate,
            appleMusicUrl: songLink(item.artist, t.name),
            addedAt: new Date().toISOString(),
          });
          addedTrackCount++;
        }
        syncedArtists++;
      }

      await savePlaylist(state);
      await writeFile(PATHS.playlistMd, renderPlaylistMd(state.tracks), "utf8");

      console.log(
        `Built list: ${syncedArtists} new artist(s), added ${addedTrackCount} song(s), ` +
          `pruned ${prunedCount} past song(s). Wrote data/playlist.md.`,
      );
      if (unresolved.length) {
        console.log(`No songs found for: ${unresolved.join(", ")}`);
      }
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync().catch(fail);
