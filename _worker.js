export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // API TEST
    // ==========================================

    if (url.pathname === "/api/test") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Connor.fm API works.",
          kv: !!env.CONNOR_DATA
        }),
        {
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // ==========================================
    // ADMIN LOGIN
    // ==========================================

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const password = body.password;

        const storedPassword = await env.CONNOR_DATA.get("admin_password");

        if (!storedPassword) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Admin password is not configured yet."
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }

        if (password !== storedPassword) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Wrong password."
            }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            success: true
          }),
          {
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      } catch {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid request."
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    // ==========================================
    // LISTENING ROOM CODE
    // ==========================================

    if (url.pathname === "/api/listening-code" && request.method === "POST") {
      try {
        const body = await request.json();
        const code = body.code;

        if (!code || typeof code !== "string") {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Invalid code."
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }

        await env.CONNOR_DATA.put("listening_code", code);

        return new Response(
          JSON.stringify({
            success: true
          }),
          {
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      } catch {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid request."
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    // ==========================================
    // PUBLIC LISTENING ROOM CHECK
    // ==========================================

    if (url.pathname === "/api/listening-code/check" && request.method === "POST") {
      try {
        const body = await request.json();
        const code = body.code;

        const storedCode = await env.CONNOR_DATA.get("listening_code");

        if (!storedCode) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Listening room is not configured."
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }

        if (code !== storedCode) {
          return new Response(
            JSON.stringify({
              success: false
            }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );
        }

        return new Response(
          JSON.stringify({
            success: true
          }),
          {
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      } catch {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid request."
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    // ==========================================
    // STATIC WEBSITE
    // ==========================================

    return env.ASSETS.fetch(request);
  }
};
