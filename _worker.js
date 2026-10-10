// ==========================================
// connor.fm — Cloudflare Worker
//
// Handles /api/* and /media/*.
// Everything else is served from the static assets.
//
// Storage (everything works on the Workers free plan):
//   KV (CONNOR_DATA) — page content, uploads, admin sessions
//   _database.js     — access codes, plays, comments, questions and
//                      stats, also in KV, written sparingly
// ==========================================

import { createStore } from "./_database.js";

// Everything that can be edited in the admin panel.
// Each key is stored in KV as "content:<key>".
//
// Field types:
//   text  — single line       long  — multi-line text
//   url   — http(s) or /path  id / status / date — used by messages
//   listOf(...)               — list of objects

const SCHEMA = {
  site: {
    footerName: "text",
    footerYear: "text",
    nowListening: "text",
    nowListeningLink: "url"
  },

  home: {
    label: "text",
    coming: "text",
    title: "text",
    description: "long",
    coverImage: "url",
    coverText: "text",
    countdownAt: "date",
    countdownLabel: "text",
    countdownDone: "text",
    countdownLink: "url"
  },

  music: {
    label: "text",
    lockedLabel: "text",
    title: "text",
    type: "text",
    year: "text",
    tracks: "text",
    status: "text",
    description: "long",
    coverImage: "url",
    coverText: "text",
    accessLabel: "text",
    accessDescription: "long",
    roomLabel: "text",
    roomTitle: "text",
    footerLeft: "text",
    footerRight: "text",
    tracklist: listOf({ title: "text", duration: "text", audio: "url" })
  },

  archivePage: {
    label: "text",
    note: "long",
    footerLeft: "text",
    footerRight: "text"
  },

  archive: listOf({ year: "text", title: "text", type: "text", link: "url", image: "url", audio: "url" }),

  about: {
    label: "text",
    title: "text",
    intro: "long",
    description: "long",
    facts: listOf({ label: "text", value: "text" })
  },

  messagesPage: {
    label: "text",
    title: "text",
    intro: "long"
  },

  messages: listOf({ id: "id", title: "text", text: "long", status: "status", publishAt: "date" }),

  questionsPage: {
    label: "text",
    title: "text",
    intro: "long",
    placeholder: "text"
  }
};

const CONTENT_KEYS = Object.keys(SCHEMA);

const SESSION_TTL = 60 * 60 * 24; // 24 hours

// The free plan allows ~10 ms of CPU time per request; this stays well below it.
// Older hashes with other settings are upgraded on the next successful login.
const PBKDF2_ITERATIONS = 6000;

const RATE_LIMITS = {
  login: { max: 10, window: 15 * 60 },
  code: { max: 20, window: 15 * 60 },
  question: { max: 5, window: 60 * 60 },
  comment: { max: 20, window: 15 * 60 }
};

// Pages that are counted in the stats.
const PAGES = ["/", "/music", "/archive", "/about", "/messages", "/questions"];

const LISTEN_TTL = 60 * 60 * 6; // listening-room access lasts 6 hours

// Uploads are stored in KV (max. 25 MB per value).
const MEDIA_MAX_SIZE = 25 * 1024 * 1024;

const MEDIA_TYPES = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

const LIMITS = {
  shortText: 200,
  longText: 5000,
  listItems: 200
};


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/media/")) {
      return serveMedia(request, env, url);
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      return await handleApi(request, env, url);
    } catch (error) {
      console.error(`${request.method} ${url.pathname} failed:`, error);

      return json({ success: false, error: "Something went wrong." }, 500);
    }
  }
};


// ==========================================
// ROUTER
// ==========================================

async function handleApi(request, env, url) {
  const routes = {
    "/api/test": {
      GET: () => json({ success: true, message: "connor.fm API works." })
    },

    "/api/content": {
      GET: () => getPublicContent(env)
    },

    "/api/listening-room": {
      GET: () => getListeningRoom(request, env),
      POST: () => openListeningRoom(request, env)
    },

    "/api/listening-room/comments": {
      GET: () => listRoomComments(request, env),
      POST: () => addRoomComment(request, env)
    },

    "/api/listening-room/event": {
      POST: () => logRoomEvent(request, env)
    },

    "/api/hit": {
      POST: () => countHit(request, env)
    },

    "/api/questions": {
      GET: async () => json({ success: true, questions: await db(env).listQuestions(true) }),
      POST: () => askQuestion(request, env)
    },

    "/api/admin/login": {
      POST: () => login(request, env)
    },

    "/api/admin/logout": {
      POST: () => logout(request, env)
    },

    "/api/admin/check": {
      GET: async () => json({ authenticated: await isAuthenticated(request, env) })
    },

    "/api/admin/password": {
      POST: requireAdmin(request, env, () => changePassword(request, env))
    },

    "/api/admin/content": {
      GET: requireAdmin(request, env, () => getAdminContent(env)),
      POST: requireAdmin(request, env, () => saveContent(request, env))
    },

    "/api/admin/codes": {
      GET: requireAdmin(request, env, () => listCodes(env)),
      POST: requireAdmin(request, env, () => createCode(request, env)),
      PATCH: requireAdmin(request, env, () => updateCode(request, env)),
      DELETE: requireAdmin(request, env, () => deleteById(url, id => db(env).deleteCode(id)))
    },

    "/api/admin/codes/activity": {
      GET: requireAdmin(request, env, async () =>
        json({ success: true, ...(await db(env).codeActivity(url.searchParams.get("id") || "")) })
      )
    },

    "/api/admin/comments": {
      GET: requireAdmin(request, env, async () => json({ success: true, comments: await db(env).listComments(true) })),
      DELETE: requireAdmin(request, env, () => deleteById(url, id => db(env).deleteComment(id)))
    },

    "/api/admin/questions": {
      GET: requireAdmin(request, env, async () => json({ success: true, questions: await db(env).listQuestions(false) })),
      PATCH: requireAdmin(request, env, () => updateQuestion(request, env)),
      DELETE: requireAdmin(request, env, () => deleteById(url, id => db(env).deleteQuestion(id)))
    },

    "/api/admin/stats": {
      GET: requireAdmin(request, env, () => getStats(env, url))
    },

    "/api/admin/media": {
      GET: requireAdmin(request, env, () => listMedia(env)),
      POST: requireAdmin(request, env, () => uploadMedia(request, env, url)),
      DELETE: requireAdmin(request, env, () => deleteMedia(env, url))
    }
  };

  const route = routes[url.pathname];

  if (!route) {
    return json({ success: false, error: "Not found." }, 404);
  }

  const handler = route[request.method];

  if (!handler) {
    return json({ success: false, error: "Method not allowed." }, 405);
  }

  return handler();
}


function requireAdmin(request, env, handler) {
  return async () => {
    if (!(await isAuthenticated(request, env))) {
      return json({ success: false, error: "Unauthorized." }, 401);
    }

    return handler();
  };
}


// ==========================================
// PUBLIC CONTENT
// ==========================================

async function getPublicContent(env) {
  const content = await readContent(env);

  const music = content.music ? { ...content.music } : null;

  // The tracklist is only revealed inside the listening room.
  if (music) {
    delete music.tracklist;
  }

  return json({
    success: true,
    ...content,
    music,
    archive: content.archive || [],
    messages: publishedMessages(content.messages || [])
  });
}


function publishedMessages(messages) {
  const now = Date.now();

  return messages
    .filter(message => {
      if (message.status === "live") {
        return true;
      }

      if (message.status === "scheduled" && message.publishAt) {
        const time = Date.parse(message.publishAt);
        return !Number.isNaN(time) && time <= now;
      }

      return false;
    })
    .map(message => ({
      id: message.id,
      title: message.title,
      text: message.text,
      publishAt: message.publishAt
    }))
    .sort((a, b) => (Date.parse(b.publishAt) || 0) - (Date.parse(a.publishAt) || 0));
}


// ==========================================
// LISTENING ROOM
//
// Every person gets their own access code (admin → listening room).
// Entering a code opens a session (cookie), which is used for the
// private mp3s, comments and to see who listened to what.
// ==========================================

function db(env) {
  return createStore(env);
}


async function openListeningRoom(request, env) {
  if (!(await withinRateLimit(request, env, "code"))) {
    return json({ success: false, error: "Too many attempts. Try again later." }, 429);
  }

  await importLegacyCode(env);

  const body = await readJson(request);
  const code = normalizeCode(body?.code);
  const token = crypto.randomUUID();

  const codeId = code && (await db(env).unlock(code, token, LISTEN_TTL));

  if (!codeId) {
    return json({ success: false, error: "Invalid access code." }, 401);
  }

  return json(
    { success: true, tracklist: await readTracklist(env) },
    200,
    { "Set-Cookie": `connor_listen=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${LISTEN_TTL}` }
  );
}


async function getListeningRoom(request, env) {
  if (!(await listeningCodeId(request, env))) {
    return json({ success: false, error: "Access code required." }, 401);
  }

  return json({ success: true, tracklist: await readTracklist(env) });
}


async function readTracklist(env) {
  const music = await readKey(env, "music");

  return Array.isArray(music?.tracklist) ? music.tracklist : [];
}


// The id of the access code behind this visitor's session (or null).
// Paused or deleted codes lose access immediately.
async function listeningCodeId(request, env) {
  const token = getCookie(request, "connor_listen");

  return token ? db(env).sessionCode(token) : null;
}


async function hasListeningAccess(request, env) {
  return Boolean(await listeningCodeId(request, env));
}


// Tracks are identified by their mp3 link, so comments and plays
// stay with the right song when the tracklist is reordered.
async function findTrack(env, key) {
  const tracks = await readTracklist(env);

  return typeof key === "string" && key ? tracks.find(track => track.audio === key) : null;
}


async function logRoomEvent(request, env) {
  const codeId = await listeningCodeId(request, env);

  if (!codeId) {
    return json({ success: false, error: "Access code required." }, 401);
  }

  const body = await readJson(request);
  const track = await findTrack(env, body?.track);

  if (!track || !["play", "complete"].includes(body?.type)) {
    return json({ success: false, error: "Invalid event." }, 400);
  }

  await db(env).logEvent(body.type, codeId, track.audio, track.title || "untitled");

  return json({ success: true });
}


async function listRoomComments(request, env) {
  if (!(await hasListeningAccess(request, env))) {
    return json({ success: false, error: "Access code required." }, 401);
  }

  return json({ success: true, comments: await db(env).listComments(false) });
}


async function addRoomComment(request, env) {
  const codeId = await listeningCodeId(request, env);

  if (!codeId) {
    return json({ success: false, error: "Access code required." }, 401);
  }

  if (!(await withinRateLimit(request, env, "comment"))) {
    return json({ success: false, error: "Too many comments. Try again later." }, 429);
  }

  const body = await readJson(request);
  const track = await findTrack(env, body?.track);
  const message = text(body?.text, 500).trim();
  const at = Number(body?.at);

  if (!track || !message) {
    return json({ success: false, error: "Write something first." }, 400);
  }

  const comment = await db(env).addComment({
    track: track.audio,
    at: Number.isFinite(at) && at >= 0 ? Math.round(at * 10) / 10 : null,
    name: text(body?.name, 40).trim(),
    text: message,
    codeId
  });

  return json({ success: true, comment });
}


// ---------- access codes (admin) ----------

// Lowercase, so codes are not case-sensitive.
function normalizeCode(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}


function randomCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));

  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}


// Before codes per person existed there was one shared code in KV.
// It is taken over once as a code called "general".
async function importLegacyCode(env) {
  const legacy = await env.CONNOR_DATA.get("listening_code");

  if (!legacy || (await env.CONNOR_DATA.get("listening_code_imported"))) {
    return;
  }

  await db(env).createCode("general", normalizeCode(legacy));
  await env.CONNOR_DATA.put("listening_code_imported", "1");
}


async function listCodes(env) {
  await importLegacyCode(env);

  return json({ success: true, codes: await db(env).listCodes() });
}


async function createCode(request, env) {
  const body = await readJson(request);
  const label = text(body?.label, 60).trim();
  const code = normalizeCode(body?.code) || randomCode();

  if (!label) {
    return json({ success: false, error: "Give the code a name (who is it for?)." }, 400);
  }

  if (code.length < 4 || code.length > 32 || !/^[a-z0-9-]+$/.test(code)) {
    return json({ success: false, error: "Codes use 4–32 letters, numbers or dashes." }, 400);
  }

  const result = await db(env).createCode(label, code);

  if (result.error) {
    return json({ success: false, error: result.error }, 409);
  }

  return listCodes(env);
}


async function updateCode(request, env) {
  const body = await readJson(request);

  if (typeof body?.id !== "string") {
    return json({ success: false, error: "Invalid code." }, 400);
  }

  await db(env).updateCode(body.id, {
    label: typeof body.label === "string" ? text(body.label, 60).trim() : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined
  });

  return listCodes(env);
}


async function deleteById(url, remove) {
  const id = url.searchParams.get("id");

  if (!id) {
    return json({ success: false, error: "Missing id." }, 400);
  }

  await remove(id);

  return json({ success: true });
}


// ==========================================
// STATS
//
// No cookies, no IP addresses stored. Unique visitors are
// counted with a daily hash of IP + browser + secret salt.
// ==========================================

async function countHit(request, env) {
  const body = await readJson(request);
  const userAgent = request.headers.get("User-Agent") || "";

  let path = typeof body?.path === "string" ? body.path : "";
  path = path.replace(/\.html$/, "").replace(/(.)\/$/, "$1").replace(/^\/index$/, "/");

  if (!PAGES.includes(path) || /bot|crawl|spider|slurp|preview|headless/i.test(userAgent)) {
    return new Response(null, { status: 204 });
  }

  let salt = await env.CONNOR_DATA.get("stats_salt");

  if (!salt) {
    salt = crypto.randomUUID();
    await env.CONNOR_DATA.put("stats_salt", salt);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${day}|${ip}|${userAgent}`));

  await db(env).hit(path, bytesToBase64(new Uint8Array(digest)).slice(0, 22));

  return new Response(null, { status: 204 });
}


async function getStats(env, url) {
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);

  return json({ success: true, days, ...(await db(env).stats(days)) });
}


// ==========================================
// QUESTIONS
// ==========================================

async function askQuestion(request, env) {
  if (!(await withinRateLimit(request, env, "question"))) {
    return json({ success: false, error: "Too many questions. Try again later." }, 429);
  }

  const body = await readJson(request);
  const question = text(body?.text, 500).trim();

  if (question.length < 3) {
    return json({ success: false, error: "Write a question first." }, 400);
  }

  const result = await db(env).addQuestion(question);

  if (result.error) {
    return json({ success: false, error: result.error }, 503);
  }

  return json({ success: true });
}


async function updateQuestion(request, env) {
  const body = await readJson(request);

  if (typeof body?.id !== "string") {
    return json({ success: false, error: "Invalid question." }, 400);
  }

  await db(env).updateQuestion(body.id, {
    answer: typeof body.answer === "string" ? text(body.answer, LIMITS.longText) : undefined,
    published: typeof body.published === "boolean" ? body.published : undefined
  });

  return json({ success: true });
}


// ==========================================
// ADMIN — AUTH
// ==========================================

async function login(request, env) {
  if (!(await withinRateLimit(request, env, "login"))) {
    return json({ success: false, error: "Too many attempts. Try again later." }, 429);
  }

  const body = await readJson(request);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!password || !(await verifyAdminPassword(env, password))) {
    return json({ success: false, error: "Wrong password." }, 401);
  }

  const token = crypto.randomUUID();

  await env.CONNOR_DATA.put(`session:${token}`, "1", { expirationTtl: SESSION_TTL });

  return json({ success: true }, 200, {
    "Set-Cookie": sessionCookie(token, SESSION_TTL)
  });
}


async function logout(request, env) {
  const token = getSessionToken(request);

  if (token) {
    await env.CONNOR_DATA.delete(`session:${token}`);
  }

  return json({ success: true }, 200, {
    "Set-Cookie": sessionCookie("", 0)
  });
}


async function changePassword(request, env) {
  const body = await readJson(request);

  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!(await verifyAdminPassword(env, currentPassword))) {
    return json({ success: false, error: "Current password is incorrect." }, 401);
  }

  if (newPassword.length < 12) {
    return json({ success: false, error: "New password must contain at least 12 characters." }, 400);
  }

  await env.CONNOR_DATA.put("admin_password", await hashPassword(newPassword));

  const token = getSessionToken(request);

  if (token) {
    await env.CONNOR_DATA.delete(`session:${token}`);
  }

  return json({ success: true }, 200, {
    "Set-Cookie": sessionCookie("", 0)
  });
}


function sessionCookie(token, maxAge) {
  return `connor_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}


function getSessionToken(request) {
  return getCookie(request, "connor_session");
}


function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));

  return match ? match[1] : null;
}


async function isAuthenticated(request, env) {
  const token = getSessionToken(request);

  if (!token) {
    return false;
  }

  return (await env.CONNOR_DATA.get(`session:${token}`)) === "1";
}


// ==========================================
// ADMIN — CONTENT
// ==========================================

async function getAdminContent(env) {
  const content = await readContent(env);

  return json({ success: true, ...content });
}


async function saveContent(request, env) {
  const body = await readJson(request);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, error: "Invalid content." }, 400);
  }

  for (const key of CONTENT_KEYS) {
    if (body[key] !== undefined) {
      await env.CONNOR_DATA.put(`content:${key}`, JSON.stringify(sanitize(SCHEMA[key], body[key])));
    }
  }

  // Read the data back so the admin panel shows what was actually stored.
  return getAdminContent(env);
}


async function readContent(env) {
  const values = await Promise.all(CONTENT_KEYS.map(key => readKey(env, key)));
  const result = Object.fromEntries(CONTENT_KEYS.map((key, index) => [key, values[index]]));

  // Older versions stored the about facts as fixed fields.
  const about = result.about;

  if (about && !Array.isArray(about.facts)) {
    about.facts = [
      ["name", about.name],
      ["currently", about.currently],
      ["working on", about.working],
      ["website", about.website]
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => ({ label, value }));
  }

  return result;
}


async function readKey(env, key) {
  const value = await env.CONNOR_DATA.get(`content:${key}`);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}


// ==========================================
// SANITIZING
// ==========================================

function listOf(item) {
  return { $list: item };
}


const FIELD_TYPES = {
  text: value => text(value),
  long: value => text(value, LIMITS.longText),
  url: value => safeLink(value),
  id: value => text(value, 64) || crypto.randomUUID(),
  status: value => (["draft", "live", "scheduled"].includes(value) ? value : "draft"),
  date: value => {
    const date = text(value, 40);
    return date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
  }
};


// Keeps only the fields described in the schema,
// with the right types and lengths.
function sanitize(schema, value) {
  if (typeof schema === "string") {
    return FIELD_TYPES[schema](value);
  }

  if (schema.$list) {
    return Array.isArray(value)
      ? value
          .filter(item => item && typeof item === "object")
          .slice(0, LIMITS.listItems)
          .map(item => sanitize(schema.$list, item))
      : [];
  }

  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return Object.fromEntries(
    Object.entries(schema).map(([key, type]) => [key, sanitize(type, source[key])])
  );
}


function text(value, max = LIMITS.shortText) {
  return typeof value === "string" ? value.slice(0, max) : "";
}


// Only allow http(s) links and site-relative paths.
function safeLink(value) {
  const link = text(value, 500).trim();

  if (!link) {
    return "";
  }

  if (link.startsWith("/") && !link.startsWith("//")) {
    return link;
  }

  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}


// ==========================================
// MEDIA (mp3 + images)
//
// Stored in KV as "media:<id>" with metadata.
// Files uploaded as "private" (listening room) are
// only served with listening-room access or as admin.
// ==========================================

async function uploadMedia(request, env, url) {
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const extension = MEDIA_TYPES[type];

  if (!extension) {
    return json({ success: false, error: "Only mp3, jpg, png, webp and gif files are allowed." }, 415);
  }

  const size = Number(request.headers.get("Content-Length")) || 0;

  if (size > MEDIA_MAX_SIZE) {
    return json({ success: false, error: "File is too big (max. 25 MB)." }, 413);
  }

  const data = await request.arrayBuffer();

  if (data.byteLength === 0 || data.byteLength > MEDIA_MAX_SIZE) {
    return json({ success: false, error: "File is empty or too big (max. 25 MB)." }, 413);
  }

  const id = `${crypto.randomUUID()}.${extension}`;

  const metadata = {
    name: (url.searchParams.get("name") || id).slice(0, 120),
    type: type === "audio/mp3" ? "audio/mpeg" : type,
    size: data.byteLength,
    private: url.searchParams.get("private") === "1",
    uploaded: new Date().toISOString()
  };

  await env.CONNOR_DATA.put(`media:${id}`, data, { metadata });

  return json({ success: true, file: { id, url: `/media/${id}`, ...metadata } });
}


async function listMedia(env) {
  const files = [];
  let cursor;

  do {
    const page = await env.CONNOR_DATA.list({ prefix: "media:", cursor });

    page.keys.forEach(key => {
      const id = key.name.slice("media:".length);
      files.push({ id, url: `/media/${id}`, ...(key.metadata || {}) });
    });

    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  files.sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));

  return json({ success: true, files });
}


async function deleteMedia(env, url) {
  const id = url.searchParams.get("id") || "";

  if (!/^[\w-]+\.\w+$/.test(id)) {
    return json({ success: false, error: "Invalid file." }, 400);
  }

  await env.CONNOR_DATA.delete(`media:${id}`);

  return json({ success: true });
}


async function serveMedia(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const id = url.pathname.slice("/media/".length);

  if (!/^[\w-]+\.\w+$/.test(id)) {
    return new Response("Not found.", { status: 404 });
  }

  const { value, metadata } = await env.CONNOR_DATA.getWithMetadata(`media:${id}`, { type: "arrayBuffer" });

  if (!value) {
    return new Response("Not found.", { status: 404 });
  }

  if (metadata?.private && !(await hasListeningAccess(request, env)) && !(await isAuthenticated(request, env))) {
    return new Response("Access code required.", { status: 403 });
  }

  const headers = {
    "Content-Type": metadata?.type || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    // File ids never change, so public files can be cached forever.
    "Cache-Control": metadata?.private ? "private, no-store" : "public, max-age=31536000, immutable"
  };

  const total = value.byteLength;
  const range = parseRange(request.headers.get("Range"), total);

  // Range requests are needed to skip around in audio files.
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
  }

  if (range) {
    const [start, end] = range;

    return new Response(request.method === "HEAD" ? null : value.slice(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1)
      }
    });
  }

  return new Response(request.method === "HEAD" ? null : value, {
    headers: { ...headers, "Content-Length": String(total) }
  });
}


function parseRange(header, total) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");

  if (!match || (!match[1] && !match[2])) {
    return null;
  }

  let start;
  let end;

  if (!match[1]) {
    // "bytes=-500" means the last 500 bytes.
    start = Math.max(0, total - Number(match[2]));
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  }

  return start > end || start >= total ? "invalid" : [start, end];
}


// ==========================================
// PASSWORDS
//
// Stored as "pbkdf2$<iterations>$<salt>$<hash>".
// A password that was put into KV as plain text
// still works and is upgraded to a hash on the
// first successful login.
// ==========================================

async function verifyAdminPassword(env, password) {
  const stored = await env.CONNOR_DATA.get("admin_password");

  if (!stored || !password) {
    return false;
  }

  if (!stored.startsWith("pbkdf2$")) {
    const valid = await safeEqual(password, stored);

    if (valid) {
      await env.CONNOR_DATA.put("admin_password", await hashPassword(password));
    }

    return valid;
  }

  const [, iterations, salt, hash] = stored.split("$");
  const candidate = await pbkdf2(password, base64ToBytes(salt), Number(iterations));
  const valid = await safeEqual(bytesToBase64(candidate), hash);

  // Re-hash passwords stored with other settings (e.g. the slower older ones).
  if (valid && Number(iterations) !== PBKDF2_ITERATIONS) {
    await env.CONNOR_DATA.put("admin_password", await hashPassword(password));
  }

  return valid;
}


async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);

  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}


async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );

  return new Uint8Array(bits);
}


// Compares two strings without leaking timing information.
async function safeEqual(a, b) {
  const encoder = new TextEncoder();

  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b))
  ]);

  return crypto.subtle.timingSafeEqual(hashA, hashB);
}


function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}


function base64ToBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}


// ==========================================
// RATE LIMITING
//
// Per-IP counters in the cache (no KV writes, so the
// free plan's write limit stays free for content).
// ==========================================

async function withinRateLimit(request, env, scope) {
  const { max, window } = RATE_LIMITS[scope];
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  return db(env).rateLimit(`${scope}:${ip}`, max, window);
}


// ==========================================
// HELPERS
// ==========================================

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}


function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}
