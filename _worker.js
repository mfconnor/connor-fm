export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    return env.ASSETS.fetch(request);
  }
};
