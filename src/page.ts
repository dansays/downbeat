import type { SeenEvent } from "./types.ts";
import type { ArtistEnrichment } from "./enrich.ts";
import {
  type CalendarOptions,
  confidenceEmoji,
  confidenceLabel,
  displayDate,
  displayMonth,
  displayTime,
  parseYmd,
} from "./ics.ts";

/**
 * The published show page (docs/index.html): a month-grid calendar of upcoming matches that links
 * down to a detail card per show — album art, the why-you'd-like-it rationale, suggested songs as
 * Apple Music searches, and tickets/map/artist links. Self-contained static HTML (inline CSS, a
 * few lines of inline JS), served by GitHub Pages next to calendar.ics.
 */

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Apple Maps search link for a venue address. */
const appleMapsUrl = (query: string): string =>
  `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
/** Apple Music search link (no free lookup API, so link searches). */
const appleMusicSearchUrl = (term: string): string =>
  `https://music.apple.com/us/search?term=${encodeURIComponent(term)}`;
/** AllMusic artist search link. */
const allMusicUrl = (artist: string): string =>
  `https://www.allmusic.com/search/artists/${encodeURIComponent(artist)}`;

/** Initials for the vinyl-sleeve placeholder when no album art was found. */
function initials(artist: string): string {
  const words = artist.split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w));
  const first = words[0]?.[0] ?? "♪";
  const second = words.length > 1 ? words[words.length - 1]?.[0] ?? "" : "";
  return (first + second).toUpperCase();
}

// --- calendar grid -----------------------------------------------------------

/** One month's 7-column grid; days with shows are anchors down to that day's cards. */
function renderMonth(yyyyMm: string, byDate: Map<string, SeenEvent[]>): string {
  const p = yyyyMm.split("-");
  const y = Number(p[0]);
  const m = Number(p[1]);
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells: string[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="day blank"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const shows = byDate.get(date);
    if (!shows?.length) {
      cells.push(`<div class="day" id="c-${date}"><span class="n">${d}</span></div>`);
      continue;
    }
    const dots = shows
      .slice(0, 4)
      .map((s) => `<i class="dot ${s.confidence ?? "good"}"></i>`)
      .join("");
    const more = shows.length > 4 ? `<i class="more">+</i>` : "";
    const title = shows.map((s) => `${s.artist} — ${s.venue}`).join("\n");
    cells.push(
      `<a class="day has" id="c-${date}" href="#d-${date}" title="${escapeHtml(title)}">` +
        `<span class="n">${d}</span><span class="dots">${dots}${more}</span></a>`,
    );
  }

  return `<div class="month">
  <h3>${escapeHtml(displayMonth(yyyyMm))}</h3>
  <div class="dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
  <div class="grid">${cells.join("")}</div>
</div>`;
}

// --- show cards ----------------------------------------------------------------

function renderCard(
  ev: SeenEvent,
  enrichment: ArtistEnrichment | undefined,
  venueLocation?: (venue: string) => string | undefined,
): string {
  const conf = ev.confidence ?? "good";
  const emoji = confidenceEmoji(ev.confidence);
  const badge = emoji
    ? `<span class="badge ${conf}">${emoji} ${escapeHtml(confidenceLabel(ev.confidence))}</span>`
    : "";

  const art = enrichment?.artworkUrl
    ? `<img class="art" src="${escapeHtml(enrichment.artworkUrl)}" alt="" loading="lazy" width="400" height="400">`
    : `<div class="art ph" aria-hidden="true"><span>${escapeHtml(initials(ev.artist))}</span></div>`;

  const location = venueLocation?.(ev.venue) ?? ev.venue;
  const searchName = enrichment?.searchArtist ?? ev.artist;
  // Last.fm top-track lists occasionally include scrobble junk with sprawling titles; real jazz
  // song titles are short, so a length cap filters the noise without a blocklist.
  const cleanSongs = enrichment?.songs?.filter((s) => s.length <= 45) ?? [];
  const songs = cleanSongs.length
    ? `<div class="songs">${cleanSongs
        .map(
          (song) =>
            `<a class="song" href="${escapeHtml(appleMusicSearchUrl(`${searchName} ${song}`))}"` +
            ` target="_blank" rel="noopener">&#9835; ${escapeHtml(song)}</a>`,
        )
        .join("")}</div>`
    : "";

  const links = [
    ev.ticketUrl
      ? `<a href="${escapeHtml(ev.ticketUrl)}" target="_blank" rel="noopener">Tickets&nbsp;/&nbsp;info</a>`
      : "",
    `<a href="${escapeHtml(appleMapsUrl(location))}" target="_blank" rel="noopener">Map</a>`,
    `<a href="${escapeHtml(enrichment?.appleMusicArtistUrl ?? appleMusicSearchUrl(searchName))}"` +
      ` target="_blank" rel="noopener">Apple&nbsp;Music</a>`,
    `<a href="${escapeHtml(allMusicUrl(searchName))}" target="_blank" rel="noopener">AllMusic</a>`,
  ]
    .filter(Boolean)
    .join(`<span class="sep">&middot;</span>`);

  const why = ev.description ? `<p class="why">${escapeHtml(ev.description)}</p>` : "";

  return `<article class="card ${conf}">
  ${art}
  <div class="body">
    <div class="topline"><span class="time">${escapeHtml(displayTime(ev.time))}</span>${badge}</div>
    <h4>${escapeHtml(ev.artist)}</h4>
    <div class="venue">${escapeHtml(ev.venue)}</div>
    <a class="addr" href="${escapeHtml(appleMapsUrl(location))}" target="_blank" rel="noopener">${escapeHtml(location)}</a>
    ${why}
    ${songs}
    <div class="links">${links}</div>
  </div>
</article>`;
}

// --- page ------------------------------------------------------------------------

/** Render the full show page. */
export function renderShowPage(
  events: SeenEvent[],
  enrichment: Map<string, ArtistEnrichment>,
  opts: CalendarOptions,
): string {
  const icsHttps = `${opts.baseUrl}/calendar.ics`;
  const icsWebcal = icsHttps.replace(/^https?:\/\//, "webcal://");
  const updated = opts.now.toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const byDate = new Map<string, SeenEvent[]>();
  for (const ev of events) {
    const list = byDate.get(ev.date) ?? [];
    list.push(ev);
    byDate.set(ev.date, list);
  }
  const months = [...new Set(events.map((e) => e.date.slice(0, 7)))].sort();

  const calendar = months.length
    ? `<section class="calendar" aria-label="Calendar of shows">
  <div class="months">${months.map((mo) => renderMonth(mo, byDate)).join("\n")}</div>
  <p class="legend"><i class="dot strong"></i> standout &nbsp; <i class="dot good"></i> solid match &nbsp; <i class="dot tentative"></i> close call &nbsp;&mdash; tap a day to jump to its shows</p>
</section>`
    : "";

  const days = [...byDate.keys()].sort();
  const sections = days
    .map((date) => {
      const shows = byDate.get(date) ?? [];
      const cards = shows
        .map((ev) => renderCard(ev, enrichment.get(ev.artist), opts.venueLocation))
        .join("\n");
      return `<section class="dayblock" id="d-${date}">
  <h2>${escapeHtml(displayDate(date))}<span class="count">${shows.length} show${shows.length === 1 ? "" : "s"}</span></h2>
  <div class="cards">${cards}</div>
</section>`;
    })
    .join("\n");

  const shows = events.length
    ? sections
    : `<p class="empty">No upcoming shows on the calendar right now — check back after the next scan.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Upcoming Los Angeles jazz shows matched to my taste — with why each one made the list.">
<title>${escapeHtml(opts.calName)}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b101e;
    --panel: #131a2c;
    --panel-2: #1a2338;
    --line: #232e48;
    --text: #e9edf6;
    --muted: #94a0b8;
    --faint: #64708a;
    --blue: #6ea2ff;
    --amber: #e8b04b;
    --gray-dot: #8b95ab;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: var(--bg); color: var(--text);
         background-image: radial-gradient(1100px 480px at 70% -180px, #1b2c55cc, transparent 70%); }
  .wrap { max-width: 1160px; margin: 0 auto; padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 3vw, 2rem) 4rem; }
  a { color: var(--blue); }

  /* hero */
  .eyebrow { margin: 0; font-size: .78rem; font-weight: 700; letter-spacing: .18em;
             text-transform: uppercase; color: var(--amber); }
  h1 { margin: .2rem 0 .4rem; font-family: "New York", ui-serif, Georgia, "Times New Roman", serif;
       font-size: clamp(1.9rem, 5vw, 2.9rem); font-weight: 600; letter-spacing: -.01em; }
  .sub { margin: 0 0 1.4rem; color: var(--muted); max-width: 46rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .75rem 1rem; align-items: center; }
  .subscribe { display: inline-block; background: var(--amber); color: #201703; text-decoration: none;
               padding: .68rem 1.15rem; border-radius: 10px; font-weight: 700; }
  .subscribe:hover { filter: brightness(1.08); }
  .url { font-size: .82rem; color: var(--muted); word-break: break-all; }
  .url code { background: var(--panel); border: 1px solid var(--line); padding: .2rem .45rem; border-radius: 6px; }

  /* calendar */
  .calendar { margin-top: 2.4rem; }
  .months { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(19rem, 100%), 1fr));
            gap: 1rem; }
  .month { background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
           padding: 1rem 1rem 1.1rem; }
  .month h3 { margin: 0 0 .6rem; font-size: .95rem; font-weight: 650; }
  .dow, .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .dow { margin-bottom: 4px; }
  .dow span { text-align: center; font-size: .68rem; font-weight: 700; color: var(--faint);
              letter-spacing: .06em; }
  .day { min-height: 2.55rem; border-radius: 8px; padding: .25rem .3rem; font-size: .8rem;
         color: var(--faint); display: flex; flex-direction: column; justify-content: space-between; }
  .day.blank { visibility: hidden; }
  .day.has { background: var(--panel-2); border: 1px solid var(--line); color: var(--text);
             text-decoration: none; }
  .day.has:hover { border-color: var(--blue); }
  .day.today { outline: 2px solid var(--amber); outline-offset: -2px; }
  .day .n { line-height: 1; }
  .dots { display: flex; gap: 3px; align-items: center; flex-wrap: wrap; }
  .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .dot.strong { background: var(--amber); }
  .dot.good { background: var(--blue); }
  .dot.tentative { background: var(--gray-dot); }
  .more { font-size: .65rem; font-style: normal; color: var(--muted); line-height: 1; }
  .legend { margin: .9rem 0 0; font-size: .8rem; color: var(--muted); }
  .legend .dot { margin-right: .3rem; vertical-align: baseline; }

  /* day sections */
  .dayblock { margin-top: 2.6rem; scroll-margin-top: 1rem; }
  .dayblock h2 { font-family: "New York", ui-serif, Georgia, serif; font-size: 1.35rem;
                 font-weight: 600; margin: 0 0 .9rem; padding-bottom: .45rem;
                 border-bottom: 1px solid var(--line); }
  .dayblock h2 .count { float: right; font: 600 .72rem/1.9 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                        color: var(--faint); letter-spacing: .08em; text-transform: uppercase; }

  /* cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(21.5rem, 100%), 1fr));
           gap: 1rem; align-items: start; }
  .card { display: flex; gap: .95rem; background: var(--panel); border: 1px solid var(--line);
          border-radius: 14px; padding: 1rem; }
  .card.strong { border-color: #5d4a1f; box-shadow: 0 0 0 1px #5d4a1f inset; }
  .art { width: 104px; height: 104px; border-radius: 10px; object-fit: cover; flex: none;
         background: var(--panel-2); }
  .art.ph { display: flex; align-items: center; justify-content: center;
            background: radial-gradient(circle at 50% 50%, #2a3554 0 18%, #151d33 19% 34%, #202b49 35% 52%, #151d33 53% 70%, #202b49 71% 100%); }
  .art.ph span { font: 700 1.5rem/1 "New York", ui-serif, Georgia, serif; color: var(--muted); }
  .body { min-width: 0; flex: 1; }
  .topline { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .time { font-size: .74rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
          color: var(--blue); }
  .badge { font-size: .7rem; font-weight: 700; letter-spacing: .04em; padding: .12rem .5rem;
           border-radius: 99px; }
  .badge.strong { background: #3a2d10; color: var(--amber); }
  .badge.tentative { background: #252c3d; color: var(--muted); }
  h4 { margin: .3rem 0 .1rem; font-size: 1.08rem; line-height: 1.3; }
  .venue { font-size: .9rem; color: var(--text); }
  .addr { display: inline-block; font-size: .8rem; color: var(--muted); text-decoration: none;
          margin-top: .05rem; }
  .addr:hover { color: var(--blue); }
  .why { margin: .55rem 0 0; font-size: .88rem; color: #c6cede; }
  .songs { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .7rem; }
  .song { font-size: .78rem; color: var(--text); text-decoration: none; background: var(--panel-2);
          border: 1px solid var(--line); border-radius: 99px; padding: .28rem .7rem; }
  .song:hover { border-color: var(--amber); color: var(--amber); }
  .links { margin-top: .75rem; font-size: .8rem; }
  .links a { text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .links .sep { color: var(--faint); margin: 0 .45rem; }

  .empty { color: var(--muted); margin-top: 2.5rem; }
  footer { margin-top: 3.5rem; font-size: .8rem; color: var(--faint); }
  footer a { color: var(--muted); }

  /* phones: tighter cards, smaller art */
  @media (max-width: 480px) {
    .card { padding: .85rem; gap: .8rem; }
    .art { width: 76px; height: 76px; }
    .dayblock h2 .count { display: none; }
  }
</style>
</head>
<body>
  <main class="wrap">
    <header>
      <p class="eyebrow">Downbeat</p>
      <h1>${escapeHtml(opts.calName)}</h1>
      <p class="sub">Upcoming Los Angeles jazz shows matched to my taste — each with the reason it
        made the list, songs to preview, and ticket links. Subscribe and new picks land in your
        calendar automatically.</p>
      <div class="actions">
        <a class="subscribe" href="${escapeHtml(icsWebcal)}">Subscribe to the calendar</a>
        <span class="url">or paste into your calendar app: <code>${escapeHtml(icsHttps)}</code></span>
      </div>
    </header>
${calendar}
${shows}
    <footer>Generated by Downbeat &middot; updated ${escapeHtml(updated)} &middot;
      <a href="${escapeHtml(icsHttps)}">calendar.ics</a></footer>
  </main>
  <script>
    // Highlight today in the calendar grids (client-side, so the static page stays current).
    var today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    var cell = document.getElementById("c-" + today);
    if (cell) cell.classList.add("today");
  </script>
</body>
</html>
`;
}
