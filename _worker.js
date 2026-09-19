export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // API TEST
    // ==========================================

    if (url.pathname === "/api/test") {
      return json({
        success: true,
        message: "Connor.fm API works.",
        kv: !!env.CONNOR_DATA
      });
    }

    // ==========================================
    // ADMIN LOGIN
    // ==========================================

    if (
      url.pathname === "/api/admin/login" &&
      request.method === "POST"
    ) {
      try {
        const { password } = await request.json();

        const storedPassword =
          await env.CONNOR_DATA.get("admin_password");

        if (!storedPassword || password !== storedPassword) {
          return json(
            {
              success: false,
              error: "Wrong password."
            },
            401
          );
        }

        const token = crypto.randomUUID();

        await env.CONNOR_DATA.put(
          `session:${token}`,
          "1",
          {
            expirationTtl: 86400
          }
        );

        return new Response(
          JSON.stringify({
            success: true
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Set-Cookie":
                `connor_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
            }
          }
        );
      } catch {
        return json(
          {
            success: false,
            error: "Invalid request."
          },
          400
        );
      }
    }

    // ==========================================
    // ADMIN LOGOUT
    // ==========================================

    if (
      url.pathname === "/api/admin/logout" &&
      request.method === "POST"
    ) {
      const token = getSessionToken(request);

      if (token) {
        await env.CONNOR_DATA.delete(`session:${token}`);
      }

      return new Response(
        JSON.stringify({
          success: true
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Set-Cookie":
              "connor_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
          }
        }
      );
    }

    // ==========================================
    // ADMIN AUTH CHECK
    // ==========================================

    if (url.pathname === "/api/admin/check") {
      const authenticated =
        await isAuthenticated(request, env);

      return json({
        authenticated
      });
    }

    // ==========================================
    // CHANGE ADMIN PASSWORD
    // ==========================================

    if (
      url.pathname === "/api/admin/password" &&
      request.method === "POST"
    ) {
      if (!(await isAuthenticated(request, env))) {
        return json(
          {
            success: false,
            error: "Unauthorized."
          },
          401
        );
      }

      try {
        const {
          currentPassword,
          newPassword
        } = await request.json();

        const storedPassword =
          await env.CONNOR_DATA.get("admin_password");

        if (currentPassword !== storedPassword) {
          return json(
            {
              success: false,
              error: "Current password is incorrect."
            },
            401
          );
        }

        if (
          !newPassword ||
          typeof newPassword !== "string" ||
          newPassword.length < 12
        ) {
          return json(
            {
              success: false,
              error:
                "New password must contain at least 12 characters."
            },
            400
          );
        }

        await env.CONNOR_DATA.put(
          "admin_password",
          newPassword
        );

        const token = getSessionToken(request);

        if (token) {
          await env.CONNOR_DATA.delete(
            `session:${token}`
          );
        }

        return new Response(
          JSON.stringify({
            success: true
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Set-Cookie":
                "connor_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
            }
          }
        );
      } catch {
        return json(
          {
            success: false,
            error: "Invalid request."
          },
          400
        );
      }
    }

    // ==========================================
    // LISTENING ROOM CODE — GET
    // ==========================================

    if (
      url.pathname === "/api/listening-code" &&
      request.method === "GET"
    ) {
      if (!(await isAuthenticated(request, env))) {
        return json(
          {
            success: false,
            error: "Unauthorized."
          },
          401
        );
      }

      const code =
        await env.CONNOR_DATA.get("listening_code");

      return json({
        success: true,
        code: code || ""
      });
    }

    // ==========================================
    // LISTENING ROOM CODE — SAVE
    // ==========================================

    if (
      url.pathname === "/api/listening-code" &&
      request.method === "POST"
    ) {
      if (!(await isAuthenticated(request, env))) {
        return json(
          {
            success: false,
            error: "Unauthorized."
          },
          401
        );
      }

      try {
        const { code } = await request.json();

        if (
          !code ||
          typeof code !== "string" ||
          code.length < 4 ||
          code.length > 32
        ) {
          return json(
            {
              success: false,
              error:
                "Code must contain between 4 and 32 characters."
            },
            400
          );
        }

        await env.CONNOR_DATA.put(
          "listening_code",
          code
        );

        return json({
          success: true
        });
      } catch {
        return json(
          {
            success: false,
            error: "Invalid request."
          },
          400
        );
      }
    }

    // ==========================================
    // PUBLIC LISTENING ROOM CHECK
    // ==========================================

    if (
      url.pathname === "/api/listening-code/check" &&
      request.method === "POST"
    ) {
      try {
        const { code } = await request.json();

        const storedCode =
          await env.CONNOR_DATA.get("listening_code");

        if (!storedCode || code !== storedCode) {
          return json(
            {
              success: false
            },
            401
          );
        }

        return json({
          success: true
        });
      } catch {
        return json(
          {
            success: false
          },
          400
        );
      }
    }

    // ==========================================
    // GET SITE CONTENT
    // ==========================================

    if (
      url.pathname === "/api/content" &&
      request.method === "GET"
    ) {
      try {
        const data = await getContent(env);

        return json(
          {
            success: true,
            ...data
          },
          200,
          true
        );
      } catch (error) {
        console.error("GET /api/content failed:", error);

        return json(
          {
            success: false,
            error: "Could not load content."
          },
          500,
          true
        );
      }
    }

    // ==========================================
    // SAVE SITE CONTENT
    // ==========================================

    if (
      url.pathname === "/api/content" &&
      request.method === "POST"
    ) {
      if (!(await isAuthenticated(request, env))) {
        return json(
          {
            success: false,
            error: "Unauthorized."
          },
          401,
          true
        );
      }

      try {
        const body = await request.json();

        if (!body || typeof body !== "object") {
          return json(
            {
              success: false,
              error: "Invalid content."
            },
            400,
            true
          );
        }

        const allowed = [
          "about",
          "music",
          "archive",
          "messages"
        ];

        for (const key of allowed) {
          if (body[key] !== undefined) {
            await env.CONNOR_DATA.put(
              `content:${key}`,
              JSON.stringify(body[key])
            );
          }
        }

        // Read the data back immediately.
        // This confirms that the save actually reached KV.
        const savedData = await getContent(env);

        return json(
          {
            success: true,
            ...savedData
          },
          200,
          true
        );
      } catch (error) {
        console.error("POST /api/content failed:", error);

        return json(
          {
            success: false,
            error: "Invalid content."
          },
          400,
          true
        );
      }
    }

    // ==========================================
    // STATIC WEBSITE
    // ==========================================

    return env.ASSETS.fetch(request);
  }
};


// ==========================================
// HELPERS
// ==========================================

function json(data, status = 200, noCache = true) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (noCache) {
    headers["Cache-Control"] =
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

    headers["Pragma"] = "no-cache";

    headers["Expires"] = "0";
  }

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers
    }
  );
}


// ==========================================
// SESSION
// ==========================================

function getSessionToken(request) {
  const cookie =
    request.headers.get("Cookie") || "";

  const match = cookie.match(
    /(?:^|;\s*)connor_session=([^;]+)/
  );

  return match ? match[1] : null;
}


async function isAuthenticated(request, env) {
  const token =
    getSessionToken(request);

  if (!token) {
    return false;
  }

  const session =
    await env.CONNOR_DATA.get(
      `session:${token}`
    );

  return session === "1";
}


// ==========================================
// CONTENT
// ==========================================

async function getContent(env) {
  const keys = [
    "about",
    "music",
    "archive",
    "messages"
  ];

  const result = {};

  for (const key of keys) {
    const value =
      await env.CONNOR_DATA.get(
        `content:${key}`
      );

    if (value) {
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = null;
      }
    } else {
      result[key] = null;
    }
  }

  return result;
}
