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

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const password = body.password;

        const storedPassword =
          await env.CONNOR_DATA.get("admin_password");

        if (!storedPassword) {
          return json(
            {
              success: false,
              error: "Admin password is not configured."
            },
            500
          );
        }

        if (password !== storedPassword) {
          return json(
            {
              success: false,
              error: "Wrong password."
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
            success: false,
            error: "Invalid request."
          },
          400
        );
      }
    }

    // ==========================================
    // CHECK LISTENING ROOM CODE
    // ==========================================

    if (
      url.pathname === "/api/listening-code/check" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        const code = body.code;

        const storedCode =
          await env.CONNOR_DATA.get("listening_code");

        if (!storedCode) {
          return json(
            {
              success: false,
              error: "Listening room is not configured."
            },
            500
          );
        }

        if (code !== storedCode) {
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
            success: false,
            error: "Invalid request."
          },
          400
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
// JSON HELPER
// ==========================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
