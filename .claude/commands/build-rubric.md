---
description: Build data/taste-rubric.md by analyzing the Discogs collection
allowed-tools: Bash(npm run downbeat *), Bash(npx tsx *), Read, Write, Edit
---

Build (or rebuild) the jazz taste rubric at `data/taste-rubric.md` from the user's Discogs
collection. The rubric is what `/scan-jazz` uses to decide which live shows are worth a task,
so be specific and honest — do not flatter the collection.

## Steps

1. Fetch the collection:
   ```
   npm run downbeat -- discogs:dump
   ```
   This prints a JSON array of releases: `{ artists, title, year, genres, styles, formats }`.
   (Requires `DISCOGS_USERNAME` and `DISCOGS_TOKEN` in `.env`.) If it errors on missing creds,
   stop and tell the user what to add to `.env`.

2. Filter to jazz and jazz-adjacent releases — those whose `genres` include "Jazz", or whose
   `styles` are jazz substyles (Hard Bop, Modal, Bebop, Cool Jazz, Post Bop, Free Jazz,
   Spiritual Jazz, Soul-Jazz, Bossa Nova, Latin Jazz, Free Improvisation, etc.). Keep
   Funk/Soul or Latin entries only when a jazz style is also present.

3. Analyze, then **write the full file** `data/taste-rubric.md` with these sections:
   - **Loved Artists** — tally albums per artist; list them ordered by count, with the count
     shown (e.g. `John Coltrane (9 albums)`). More albums = stronger preference. Note any
     notable sidemen/labels that recur.
   - **Preferred Styles & Eras** — aggregate `styles` frequencies and the `year` distribution.
     Call out the dominant substyles and the era center of gravity (e.g. "mostly acoustic
     1955–1967").
   - **Avoid / Negative Signals** — the important part. For artists with deep catalogs,
     infer dislikes from **what's missing**. The canonical example: many acoustic-era Miles
     Davis titles but none of his electric/fusion work (*In a Silent Way*, *Bitches Brew*,
     *On the Corner*, *Jack Johnson*) → record "avoid electric-era Miles / jazz-fusion."
     Apply the same reasoning to other artists and to styles absent across the whole
     collection (e.g. no smooth jazz, no fusion). Liking an artist ≠ liking all their eras.
   - **Scoring Guidance** — concrete rules `/scan-jazz` can follow: loved headliner in a
     preferred style → strong match; preferred style by an unknown artist → possible match;
     anything hitting an avoid signal → skip even if the name is loved (e.g. a Miles tribute
     billed as "electric Miles").

4. Print a short summary of what you wrote (top loved artists, dominant styles, key avoids)
   and remind the user they can hand-edit `data/taste-rubric.md` anytime.
