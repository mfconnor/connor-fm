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
through `/admin`:

- **listening room** — access code for `/music`. The tracklist is only sent to
  the browser after the correct code was entered.
- **archive** — entries on `/archive` (optional link).
- **about** — text and facts on `/about`.
- **music** — project info and tracklist on `/music`.
- **messages** — shown on `/messages` (the `...` link). Drafts and scheduled
  messages stay hidden until they are published.

If nothing is stored yet, the pages show the text written in the HTML.

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
