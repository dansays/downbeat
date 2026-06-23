import { requireEnv } from "./config.ts";
import type { TaskInput } from "./types.ts";

// Todoist retired the REST v2 API (now 410 Gone). This uses the unified v1 API.
const API = "https://api.todoist.com/api/v1";

interface TodoistProject {
  id: string;
  name: string;
}
interface TodoistTask {
  id: string;
}
interface Paginated<T> {
  results: T[];
  next_cursor: string | null;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv("TODOIST_TOKEN")}`,
    "Content-Type": "application/json",
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Todoist ${path} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** List every project, following pagination cursors. */
async function listProjects(): Promise<TodoistProject[]> {
  const all: TodoistProject[] = [];
  let cursor: string | null = null;
  do {
    const qs = cursor ? `?limit=200&cursor=${encodeURIComponent(cursor)}` : "?limit=200";
    const page: Paginated<TodoistProject> = await api<Paginated<TodoistProject>>(
      `/projects${qs}`,
    );
    all.push(...page.results);
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}

/** Resolve a project id by name, creating the project if it doesn't exist. */
export async function resolveProjectId(name: string): Promise<string> {
  const projects = await listProjects();
  const match = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (match) return match.id;

  const created = await api<TodoistProject>("/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return created.id;
}

/** Create a single task and return its id. */
export async function createTask(input: TaskInput): Promise<string> {
  const body: Record<string, unknown> = { content: input.content };
  if (input.description) body.description = input.description;
  if (input.due_date) body.due_date = input.due_date;
  if (input.project_id) body.project_id = input.project_id;

  const task = await api<TodoistTask>("/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return task.id;
}
