#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { fetchCollection } from "./discogs.ts";
import { resolveProjectId, createTask } from "./todoist.ts";
import { eventKey, isSeen, markSeen, loadPlaylist, savePlaylist, loadDjShow, saveDjShow } from "./store.ts";
import { artistLinks, songLink } from "./links.ts";
import { topTracks } from "./lastfm.ts";
import { withRoon, searchTrack, queueTrack, controlZone, listZones, type Zone } from "./roon.ts";
import { TODOIST_PROJECT, PATHS, ROON_PLAYLIST_NAME, ROON_ZONE } from "./config.ts";
import type {
  TaskInput,
  SyncArtist,
  PlaylistTrack,
  ShowSpecArtist,
  ResolvedTrack,
  ShowSegment,
  DjShow,
} from "./types.ts";

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

// --- /dj-show (Roon) -------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

program
  .command("roon:search")
  .description("Resolve one track to a Roon/Qobuz item (pairing + search spike, and a debug tool).")
  .requiredOption("--artist <artist>")
  .requiredOption("--title <title>")
  .option("--candidates", "also print the top ranked candidates considered")
  .action(async (opts: { artist: string; title: string; candidates?: boolean }) => {
    try {
      const hit = await withRoon((ctx) =>
        searchTrack(ctx.browse, opts.artist, opts.title, (ranked) => {
          if (!opts.candidates) return;
          console.error(`Top candidates for "${opts.artist} — ${opts.title}":`);
          for (const c of ranked.slice(0, 6)) {
            console.error(`  [${c.score.toFixed(1)}] ${c.item.title}  —  ${c.item.subtitle ?? ""}`);
          }
        }),
      );
      if (!hit) {
        console.log(`not found: ${opts.artist} — ${opts.title}`);
        return;
      }
      console.log(JSON.stringify(hit, null, 2));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("roon:zones")
  .description("List the Roon zones you can queue a show into (name + id).")
  .action(async () => {
    try {
      const zones = await withRoon(({ transport }) => listZones(transport));
      if (zones.length === 0) {
        console.log("No zones found. Make sure an output/zone is enabled in Roon.");
        return;
      }
      for (const z of zones) console.log(`${z.name}\t${z.zoneId}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("dj:resolve")
  .description(
    "Resolve a show spec to Qobuz tracks. Reads a JSON array of " +
      "{artist, billedArtist, venue, showDate, tracks:[title,...]} on stdin and prints " +
      "{resolved:[...], unresolved:[...]}. One Roon session resolves all tracks.",
  )
  .action(async () => {
    try {
      const raw = (await readStdin()).trim();
      if (!raw) throw new Error("No JSON provided on stdin.");
      const spec = JSON.parse(raw) as ShowSpecArtist[];

      const { resolved, unresolved } = await withRoon(async ({ browse }) => {
        const resolved: ResolvedTrack[] = [];
        const unresolved: string[] = [];
        for (const act of spec) {
          for (const title of act.tracks) {
            const hit = await searchTrack(browse, act.artist, title);
            if (hit) {
              resolved.push({
                artist: act.artist,
                billedArtist: act.billedArtist,
                title,
                itemKey: hit.itemKey,
                matchedArtist: hit.matchedArtist,
                matchedTitle: hit.matchedTitle,
                source: hit.source,
              });
            } else {
              unresolved.push(`${act.artist} — ${title}`);
            }
          }
        }
        return { resolved, unresolved };
      });

      process.stdout.write(JSON.stringify({ resolved, unresolved }, null, 2) + "\n");
      console.error(`Resolved ${resolved.length} track(s); ${unresolved.length} unresolved.`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("dj:build")
  .description(
    "Assemble the show manifest. Reads {tracks:[ResolvedTrack,...]} on stdin, writes the ordered " +
      "running order to data/dj-show.json, and prints it. (DJ clips are interleaved here in Phase 2.)",
  )
  .option("--name <name>", "Roon playlist name to record in the manifest", ROON_PLAYLIST_NAME)
  .action(async (opts: { name: string }) => {
    try {
      const raw = (await readStdin()).trim();
      if (!raw) throw new Error("No JSON provided on stdin.");
      const parsed = JSON.parse(raw) as { tracks: ResolvedTrack[] };
      const tracks = parsed.tracks ?? [];

      const segments: ShowSegment[] = tracks.map((t) => ({
        kind: "track",
        itemKey: t.itemKey,
        artist: t.artist,
        billedArtist: t.billedArtist,
        title: t.matchedTitle || t.title,
      }));

      const show: DjShow = {
        generatedAt: new Date().toISOString(),
        playlistName: opts.name,
        segments,
      };
      await saveDjShow(show);

      console.log(`Built manifest with ${segments.length} track(s) → data/dj-show.json`);
      console.log(`Playlist: ${show.playlistName}`);
      segments.forEach((seg, i) => {
        if (seg.kind === "track") console.log(`  ${i + 1}. ${seg.billedArtist} — ${seg.title}`);
      });
    } catch (err) {
      fail(err);
    }
  });

/** Pick the target zone from the Core's zones, honoring an optional name/id request. */
function resolveZone(zones: Zone[], requested: string): Zone {
  if (requested) {
    const want = requested.toLowerCase();
    const match =
      zones.find((z) => z.zoneId === requested) ??
      zones.find((z) => z.name.toLowerCase() === want) ??
      zones.find((z) => z.name.toLowerCase().includes(want));
    if (!match) {
      throw new Error(`Zone "${requested}" not found. Zones: ${zones.map((z) => z.name).join(", ")}`);
    }
    return match;
  }
  if (zones.length === 1) return zones[0]!;
  throw new Error(
    `Multiple zones — pass --zone (or set ROON_ZONE). Zones: ${zones.map((z) => z.name).join(", ")}`,
  );
}

program
  .command("dj:queue")
  .description(
    "Queue the show from data/dj-show.json into a Roon zone, in order. By default it loads the " +
      "queue and pauses (so you can Save Queue as a playlist in Roon); pass --play to start " +
      "playback. Re-resolves each track in the live session. " +
      "(The Roon API can't create a saved playlist directly; this loads the zone's play queue.)",
  )
  .option("--zone <zone>", "target zone name or id (overrides ROON_ZONE)", ROON_ZONE)
  .option("--play", "start playback (default: load the queue and pause)")
  .option("--settle <ms>", "delay between adds, ms (keeps order stable)", "400")
  .action(async (opts: { zone: string; play?: boolean; settle: string }) => {
    try {
      const show = await loadDjShow();
      const trackSegs = show.segments.filter(
        (s): s is Extract<ShowSegment, { kind: "track" }> => s.kind === "track",
      );
      if (trackSegs.length === 0) {
        throw new Error("No tracks in data/dj-show.json. Run dj:build first.");
      }
      const settleMs = Number(opts.settle) || 0;

      const { zone, added, skipped } = await withRoon(async ({ browse, transport }) => {
        const zone = resolveZone(await listZones(transport), opts.zone);
        const added: string[] = [];
        const skipped: string[] = [];
        let isFirst = true;
        for (const seg of trackSegs) {
          // item_keys are session-scoped, so re-resolve in this live session before queueing.
          const hit = await searchTrack(browse, seg.artist, seg.title);
          if (!hit) {
            skipped.push(`${seg.billedArtist} — ${seg.title} (not found)`);
            continue;
          }
          try {
            // The first track uses "Play Now" — the only action that *replaces* the queue (so a
            // stale queue doesn't precede the show). The rest append in order. To avoid playback,
            // pause immediately after that first track, then keep appending (append won't resume).
            await queueTrack(browse, hit.itemKey, zone.zoneId, isFirst ? "playNow" : "queue");
            if (isFirst && !opts.play) await controlZone(transport, zone.zoneId, "pause");
            added.push(`${seg.billedArtist} — ${seg.title}`);
            isFirst = false;
            if (settleMs) await sleep(settleMs);
          } catch (err) {
            skipped.push(`${seg.billedArtist} — ${seg.title} (${err instanceof Error ? err.message : err})`);
          }
        }
        // Safety net: ensure we're paused at the top if the user didn't ask to play.
        if (added.length && !opts.play) await controlZone(transport, zone.zoneId, "pause");
        return { zone, added, skipped };
      });

      console.log(`Zone "${zone.name}": queued ${added.length} track(s) in order.`);
      added.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
      if (skipped.length) {
        console.log(`\nSkipped ${skipped.length}:`);
        skipped.forEach((s) => console.log(`  - ${s}`));
      }
      if (added.length) {
        console.log(
          opts.play
            ? `\nThe show is playing in "${zone.name}". Enjoy.`
            : `\nThe queue is loaded and paused in "${zone.name}". In Roon you can press play, or ` +
                `use the queue's "Save Queue as Playlist" to keep it as a playlist.`,
        );
      }
    } catch (err) {
      fail(err);
    }
  });

program.parseAsync().catch(fail);
