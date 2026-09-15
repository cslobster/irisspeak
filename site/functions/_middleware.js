// Basic-auth gate for the whole research site (Cloudflare Pages Function middleware).
// Credentials come from environment variables RESEARCH_USER / RESEARCH_PASS set on the Pages project,
// with the agreed defaults as fallback so a fresh deploy is never open.
export async function onRequest(context) {
  const { request, env, next } = context;
  // The app (site root) and the model files are public; only the research pages under /paper need the password.
  const path = new URL(request.url).pathname;
  if (!(path === "/paper" || path.startsWith("/paper/"))) return next();
  const user = env.RESEARCH_USER || "research";
  const pass = env.RESEARCH_PASS || "paper";
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Basic ")) {
    let decoded = "";
    try { decoded = atob(auth.slice(6)); } catch (e) { decoded = ""; }
    const i = decoded.indexOf(":");
    if (i > 0 && decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) {
      const res = await next();
      const h = new Headers(res.headers);
      h.set("Cache-Control", "private, no-store");
      h.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(res.body, { status: res.status, headers: h });
    }
  }
  return new Response("Iris Speak research site. Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Iris Speak research", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}
