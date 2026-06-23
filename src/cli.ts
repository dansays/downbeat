#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { fetchCollection } from "./discogs.ts";
import { resolveProjectId, createTask } from "./todoist.ts";
import { eventKey, isSeen, markSeen } from "./store.ts";
import { artistLinks } from "./links.ts";
import { TODOIST_PROJECT } from "./config.ts";
import type { TaskInput } from "./types.ts";

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

program.parseAsync().catch(fail);
