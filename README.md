# connor.fm

Personal website of connor — music, archive, about and messages.
Runs on Cloudflare Workers (static assets + a small API).

## Files

| File | What it is |
| --- | --- |
| `index.html`, `music.html`, `archive.html`, `about.html`, `questions.html`, `messages.html`, `404.html` | public pages |
| `admin.html` | admin panel at `/admin` (password protected) |
| `style.css` | styles for all public pages |
| `site.js` | small shared helpers for the public pages |
| `_worker.js` | the API under `/api/*` and `/media/*` (not served publicly) |
| `_database.js` | access codes, plays, comments, questions and stats, stored in KV (not served publicly) |
| `_headers` | security headers for the static pages |
| `wrangler.jsonc` | Cloudflare config (KV binding `CONNOR_DATA`) |
| `.assetsignore` | files that must **not** be served as part of the website |

## Content

Everything editable lives in the KV namespace `CONNOR_DATA` and is edited
through `/admin`. The admin panel has one tab per page:

| Tab | What you can edit |
| --- | --- |
| home | announcement texts, cover image or text, countdown |
| music | project info, cover, access box, listening room + tracklist, bonus tracks (public), "support me" link, page footer |
| listening room | access codes per person (create, pause, delete, see what they listened to), comments |
| archive | archive entries (with optional link), note and footer of the page |
| about | label, title, text, the list of facts |
| messages | messages (draft / published / scheduled) and the page texts |
| questions | anonymous questions from `/questions`: answer, publish, delete |
| gift | the hidden gift page behind a secret link (see below) |
| stats | page views, visitors, plays, unlocks |
| site | footer on every page, "now listening" line |
| media | all uploaded files, storage used, delete unused files |
| security | admin password |

Every text in the HTML is marked with `data-content="<key>.<field>"`;
`site.js` fills it with the saved value. If nothing is saved, the text written
in the HTML is shown. The fields allowed for each key are defined in `SCHEMA`
in `_worker.js` and the admin form in `TABS` in `admin.html` — to make a new
text editable, add it in both places and mark the element in the HTML.

The tracklist is only sent to the browser after the correct listening-room
code was entered. Drafts and scheduled messages stay hidden until published.

## Gift page

`gift.html` is a hidden page behind a secret link (admin → gift). It has no
navigation and no links to the rest of the site.

- The secret link is stored in KV, not in the code, so it stays secret even if
  the repository is public. Unknown paths reach the worker
  (`not_found_handling: "none"`), which serves `gift.html` for that link and
  the 404 page for everything else.
- Before the "opens at" date, `/api/gift` only returns the countdown. Letter,
  photos and gift stay on the server, and photos uploaded in the gift tab
  return 403. Logged in as admin you see a preview at any time.
- Gift content is never part of `/api/content`.
- A documentary can be added as a YouTube link (upload it as "unlisted"). Only
  the video id is stored; it is embedded via `youtube-nocookie.com` with
  `rel=0` and, like everything else, only sent once the page is open.

## Data and the free plan

Everything runs on the **Workers free plan** — no Durable Objects, D1 or R2.
All data lives in the one KV namespace (`CONNOR_DATA`); `_database.js` handles
access codes, plays, comments, questions and page views.

The free plan allows 1,000 KV writes and ~10 ms CPU time per request, so:

- rate limits use the Cloudflare cache, not KV (no writes)
- page views are collected in the cache and written to KV every few minutes,
  at most 250 times per day — stats can never use up the writes needed for
  saving content. Numbers in the admin can lag a few minutes behind.
- the admin password is hashed with settings that fit into the CPU limit
- pausing an access code can take up to a minute to reach every data center

Page views are counted without cookies: unique visitors per day are a hash of
IP + browser + a secret salt, the IP itself is never stored.

When access codes per person were introduced, the old single listening-room
code from KV was imported once as a code called "general".

## Uploads (mp3 + images)

Files are uploaded in the admin panel (upload button or drag & drop) and
stored in the same KV namespace as `media:<id>`, served at `/media/<id>`.

- max. 25 MB per file (KV limit), about 1 GB in total on the free plan
- mp3, jpg, png, webp, gif
- **listening-room tracks are private**: they are only served to visitors who
  entered an access code (cookie, valid 6 hours, ends immediately when the
  code is paused or deleted) or to the admin
- archive snippets and images are public and cached by the browser
- seeking in songs works via HTTP range requests

**Audio format:** export songs as **mp3 with 320 kbps** (the highest mp3
quality, ~10 MB for 4 minutes). WAV files are far too big for the 25 MB per
file and 1 GB total.

**Bonus tracks** (admin → music) are public and playable without a code; the
section stays hidden until a track has an mp3. The **support me** block below
them links to any pay-what-you-want page, e.g. a Stripe Payment Link with
"Customers choose what to pay" and a minimum of 1 €.

The listening room shows a player (play / pause, previous / next, seek bar,
time) as soon as at least one track has an mp3. Tracks without an mp3 are
listed but not playable.

## Admin password

The admin password is stored as a salted PBKDF2 hash in KV (`admin_password`).

To set (or reset) it, put a plain-text password into KV under the key
`admin_password` in the Cloudflare dashboard. It is hashed automatically on the
first successful login. Afterwards, change it from the admin panel.

Logins, listening-room codes, questions and comments are rate limited per IP
(login 10 / code 20 / comment 20 per 15 minutes, 5 questions per hour).

## API

| Route | Method | Auth |
| --- | --- | --- |
| `/api/content` | GET | public (published content only) |
| `/api/listening-room` | POST `{ code }` | public, rate limited, sets access cookie (`/music?code=…` fills it in) |
| `/api/listening-room` | GET | with access cookie |
| `/api/listening-room/comments` | GET / POST | with access cookie, rate limited |
| `/api/listening-room/event` | POST `{ type, track }` | with access cookie (plays for the stats) |
| `/api/questions` | GET (published) / POST `{ text }` | public, rate limited |
| `/api/hit` | POST `{ path }` | public (page views) |
| `/media/<id>` | GET | public, or listening-room access for private files |
| `/api/admin/login` | POST `{ password }` | rate limited |
| `/api/admin/logout` | POST | – |
| `/api/admin/check` | GET | – |
| `/api/admin/content` | GET / POST | admin |
| `/api/admin/listening-code` | GET / POST | admin |
| `/api/admin/password` | POST | admin |
| `/api/admin/media` | GET / POST (raw file) / DELETE `?id=` | admin |
| `/api/admin/codes` | GET / POST / PATCH / DELETE `?id=` | admin |
| `/api/admin/codes/activity` | GET `?id=` | admin |
| `/api/admin/comments` | GET / DELETE `?id=` | admin |
| `/api/admin/questions` | GET / PATCH / DELETE `?id=` | admin |
| `/api/admin/stats` | GET `?days=` | admin |

## Development

```sh
npx wrangler dev
```
