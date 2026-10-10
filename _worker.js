// ==========================================
// connor.fm — Cloudflare Worker
//
// Handles everything under /api/*.
// Everything else is served from the static assets.
// ==========================================

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
    footerYear: "text"
  },

  home: {
    label: "text",
    coming: "text",
    title: "text",
    description: "long",
    coverImage: "url",
    coverText: "text"
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
    tracklist: listOf({ title: "text", duration: "text" })
  },

  archivePage: {
    label: "text",
    note: "long",
    footerLeft: "text",
    footerRight: "text"
  },

  archive: listOf({ year: "text", title: "text", type: "text", link: "url" }),

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

  messages: listOf({ id: "id", title: "text", text: "long", status: "status", publishAt: "date" })
};

const CONTENT_KEYS = Object.keys(SCHEMA);

const SESSION_TTL = 60 * 60 * 24; // 24 hours

const PBKDF2_ITERATIONS = 100000; // maximum supported by Workers

const RATE_LIMITS = {
  login: { max: 10, window: 15 * 60 },
  code: { max: 20, window: 15 * 60 }
};

const LIMITS = {
  shortText: 200,
  longText: 5000,
  listItems: 200
};


export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
      POST: () => openListeningRoom(request, env)
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

    "/api/admin/listening-code": {
      GET: requireAdmin(request, env, () => getListeningCode(env)),
      POST: requireAdmin(request, env, () => saveListeningCode(request, env))
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
// ==========================================

async function openListeningRoom(request, env) {
  if (!(await withinRateLimit(request, env, "code"))) {
    return json({ success: false, error: "Too many attempts. Try again later." }, 429);
  }

  const body = await readJson(request);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  const storedCode = await env.CONNOR_DATA.get("listening_code");

  if (!storedCode || !code || !(await safeEqual(code, storedCode))) {
    return json({ success: false, error: "Invalid access code." }, 401);
  }

  const music = await readKey(env, "music");

  return json({
    success: true,
    tracklist: Array.isArray(music?.tracklist) ? music.tracklist : []
  });
}


async function getListeningCode(env) {
  const code = await env.CONNOR_DATA.get("listening_code");

  return json({ success: true, code: code || "" });
}


async function saveListeningCode(request, env) {
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (code.length < 4 || code.length > 32) {
    return json({ success: false, error: "Code must contain between 4 and 32 characters." }, 400);
  }

  await env.CONNOR_DATA.put("listening_code", code);

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
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)connor_session=([^;]+)/);

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

  return safeEqual(bytesToBase64(candidate), hash);
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
// Simple per-IP counter in KV. Not exact (KV is
// eventually consistent), but enough to stop
// someone from guessing passwords or codes.
// ==========================================

async function withinRateLimit(request, env, scope) {
  const { max, window } = RATE_LIMITS[scope];

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `ratelimit:${scope}:${ip}`;

  const count = Number(await env.CONNOR_DATA.get(key)) || 0;

  if (count >= max) {
    return false;
  }

  await env.CONNOR_DATA.put(key, String(count + 1), { expirationTtl: window });

  return true;
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
