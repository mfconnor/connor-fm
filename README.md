# connor.fm

Personal website of connor — music, archive, about and messages.
Runs on Cloudflare Workers (static assets + a small API).

## Files

| File | What it is |
| --- | --- |
| `index.html`, `music.html`, `archive.html`, `about.html`, `messages.html`, `404.html` | public pages |
| `admin.html` | admin panel at `/admin` (password protected) |
| `style.css` | styles for all public pages |
| `site.js` | small shared helpers for the public pages |
| `_worker.js` | the API under `/api/*` (not served publicly) |
| `_headers` | security headers for the static pages |
| `wrangler.jsonc` | Cloudflare config (KV binding `CONNOR_DATA`) |
| `.assetsignore` | files that must **not** be served as part of the website |

## Content

Everything editable lives in the KV namespace `CONNOR_DATA` and is edited
through `/admin`. The admin panel has one tab per page:

| Tab | What you can edit |
| --- | --- |
| home | announcement texts, cover image or text |
| music | project info, cover, access code, access box, listening room + tracklist, page footer |
| archive | archive entries (with optional link), note and footer of the page |
| about | label, title, text, the list of facts |
| messages | messages (draft / published / scheduled) and the page texts |
| site | footer on every page |
| security | admin password |

Every text in the HTML is marked with `data-content="<key>.<field>"`;
`site.js` fills it with the saved value. If nothing is saved, the text written
in the HTML is shown. The fields allowed for each key are defined in `SCHEMA`
in `_worker.js` and the admin form in `TABS` in `admin.html` — to make a new
text editable, add it in both places and mark the element in the HTML.

The tracklist is only sent to the browser after the correct listening-room
code was entered. Drafts and scheduled messages stay hidden until published.

## Admin password

The admin password is stored as a salted PBKDF2 hash in KV (`admin_password`).

To set (or reset) it, put a plain-text password into KV under the key
`admin_password` in the Cloudflare dashboard. It is hashed automatically on the
first successful login. Afterwards, change it from the admin panel.

Logins and listening-room codes are rate limited per IP
(10 / 20 attempts per 15 minutes).

## API

| Route | Method | Auth |
| --- | --- | --- |
| `/api/content` | GET | public (published content only) |
| `/api/listening-room` | POST `{ code }` | public, rate limited |
| `/api/admin/login` | POST `{ password }` | rate limited |
| `/api/admin/logout` | POST | – |
| `/api/admin/check` | GET | – |
| `/api/admin/content` | GET / POST | admin |
| `/api/admin/listening-code` | GET / POST | admin |
| `/api/admin/password` | POST | admin |

## Development

```sh
npx wrangler dev
```
