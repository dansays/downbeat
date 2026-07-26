import type { SeenEvent } from "./types.ts";

/**
 * Dependency-free iCalendar (RFC 5545) writer for the show calendar, plus a small static landing
 * page. One concern per module: turn the dedup ledger's matched shows into a subscribe-able .ics
 * (and a human-readable index.html) that GitHub Pages serves. Timed shows are emitted in
 * America/Los_Angeles with a 2-hour default duration; shows with no captured time become all-day.
 */

const TZID = "America/Los_Angeles";
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

// Confidence badges call out only the standouts and the close calls; a plain "good" match shows
// no emoji — being on the list is signal enough.
export function confidenceEmoji(c?: SeenEvent["confidence"]): string {
  return c === "strong" ? "🎯" : c === "tentative" ? "🤔" : "";
}
export function confidenceLabel(c?: SeenEvent["confidence"]): string {
  return c === "strong" ? "Standout" : c === "tentative" ? "Close call" : "";
}

export interface CalendarOptions {
  /** Display name of the calendar (X-WR-CALNAME / page title). */
  calName: string;
  /** Public https base URL the calendar is served from, no trailing slash. */
  baseUrl: string;
  /** Generation time, used for DTSTAMP and the page's "updated" line. */
  now: Date;
  /** Resolve a venue name to a street address for LOCATION; falls back to the bare name. */
  venueLocation?: (venue: string) => string | undefined;
}

// --- text helpers ----------------------------------------------------------

/** Escape a value for an iCalendar text field (RFC 5545 §3.3.11). */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a logical line to ≤75 octets with CRLF + leading-space continuations (RFC 5545 §3.1). */
function foldLine(line: string): string {
  const maxBytes = 73; // leave room for the continuation space and CRLF
  let out = "";
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (curBytes + chBytes > maxBytes) {
      out += (out ? "\r\n " : "") + cur;
      cur = ch;
      curBytes = chBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  return out + (out ? "\r\n " : "") + cur;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** Parse "YYYY-MM-DD" into numeric parts (no destructuring, to satisfy noUncheckedIndexedAccess). */
export function parseYmd(date: string): { y: number; m: number; d: number } {
  const p = date.split("-");
  return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2]) };
}

/** Parse "HH:MM" into numeric parts. */
function parseHm(time: string): { hh: number; mm: number } {
  const p = time.split(":");
  return { hh: Number(p[0]), mm: Number(p[1]) };
}

/** "YYYYMMDD" from a YYYY-MM-DD date string. */
function asDate(date: string): string {
  return date.replace(/-/g, "");
}

/** Local wall-clock stamp "YYYYMMDDTHHMMSS" from date + "HH:MM", with correct rollover. */
function asLocalDateTime(date: string, time: string, offsetMs = 0): string {
  const { y, m, d } = parseYmd(date);
  const { hh, mm } = parseHm(time);
  // Treat the wall-clock numbers as UTC purely for arithmetic, so adding the duration rolls
  // over hours/days correctly. The TZID label tells the client how to interpret them.
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm) + offsetMs);
  return (
    `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00`
  );
}

/** "YYYYMMDD" for the day after `date` (all-day DTEND is exclusive). */
function nextDay(date: string): string {
  const { y, m, d } = parseYmd(date);
  const t = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

/** UTC "YYYYMMDDTHHMMSSZ" for DTSTAMP. */
function asUtcStamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/** Stable UID for an event, derived from its dedup key so re-publishing updates, not duplicates. */
function uidFor(event: SeenEvent, baseUrl: string): string {
  const slug = event.key.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  const host = baseUrl.replace(/^https?:\/\//, "").split("/")[0] || "downbeat";
  return `${slug}@${host}`;
}

// --- venue locations -------------------------------------------------------

const normalizeVenue = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Parse `data/venues.md` into a normalized venue-name → location lookup. */
export function parseVenueLocations(venuesMd: string): Map<string, string> {
  const map = new Map<string, string>();
  let current = "";
  for (const line of venuesMd.split(/\r?\n/)) {
    const header = line.match(/^##\s+(.+?)\s*$/);
    if (header?.[1]) {
      current = header[1];
      continue;
    }
    const loc = line.match(/^\s*-\s*Location:\s*(.+?)\s*$/i);
    if (loc?.[1] && current) map.set(normalizeVenue(current), loc[1]);
  }
  return map;
}

/** Build a lookup fn from parsed locations (normalizes the query venue name). */
export function venueLocator(locations: Map<string, string>): (venue: string) => string | undefined {
  return (venue: string) => locations.get(normalizeVenue(venue));
}

// --- ICS -------------------------------------------------------------------

/** Build the full .ics document (CRLF-terminated) from a list of shows. */
export function buildIcs(events: SeenEvent[], opts: CalendarOptions): string {
  const stamp = asUtcStamp(opts.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Downbeat//LA Jazz Picks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calName)}`,
    `X-WR-TIMEZONE:${TZID}`,
    "X-PUBLISHED-TTL:PT12H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    // America/Los_Angeles VTIMEZONE (post-2007 US DST rule).
    "BEGIN:VTIMEZONE",
    `TZID:${TZID}`,
    `X-LIC-LOCATION:${TZID}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0800",
    "TZOFFSETTO:-0700",
    "TZNAME:PDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0800",
    "TZNAME:PST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uidFor(ev, opts.baseUrl)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.time) {
      lines.push(`DTSTART;TZID=${TZID}:${asLocalDateTime(ev.date, ev.time)}`);
      lines.push(`DTEND;TZID=${TZID}:${asLocalDateTime(ev.date, ev.time, DEFAULT_DURATION_MS)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${asDate(ev.date)}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(ev.date)}`);
    }
    const emoji = confidenceEmoji(ev.confidence);
    const badge = emoji ? `${emoji} ` : "";
    lines.push(`SUMMARY:${escapeText(`${badge}${ev.artist} — ${ev.venue}`)}`);
    const location = opts.venueLocation?.(ev.venue) ?? ev.venue;
    lines.push(`LOCATION:${escapeText(location)}`);
    const descParts: string[] = [];
    if (ev.description) descParts.push(ev.description);
    if (ev.ticketUrl) descParts.push(`Tickets/info: ${ev.ticketUrl}`);
    if (descParts.length) lines.push(`DESCRIPTION:${escapeText(descParts.join("\n\n"))}`);
    if (ev.ticketUrl) lines.push(`URL:${escapeText(ev.ticketUrl)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// --- display helpers (shared with the show page) -----------------------------

/** "19:30" → "7:30 PM"; passthrough if it doesn't parse. */
export function displayTime(time?: string): string {
  if (!time) return "All day";
  const { hh, mm } = parseHm(time);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time;
  const ampm = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${pad(mm)} ${ampm}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-07-03" → "Friday, July 3". */
export function displayDate(date: string): string {
  const { y, m, d } = parseYmd(date);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${MONTHS[m - 1]} ${d}`;
}

/** "2026-08" → "August 2026". */
export function displayMonth(yyyyMm: string): string {
  const p = yyyyMm.split("-");
  return `${MONTHS[Number(p[1]) - 1]} ${p[0]}`;
}
