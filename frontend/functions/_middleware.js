// Cloudflare Pages Function: two jobs, split by path.
//
// 1. /assets/*: guard the SPA fallback. `public/_redirects` rewrites unmatched
//    paths to index.html with a 200, and `public/_headers` marks /assets/*
//    immutable for a year. A request for a hashed asset missing from the
//    deployment it reaches (mid-deploy, or a stale edge) would otherwise cache
//    HTML at a JavaScript URL. Turn that fallback into an uncacheable 404.
//
// 2. Everything else: reverse-proxy the backend paths to the nginx origin so
//    the browser sees one origin (costan.io). The app relies on that: relative
//    /api fetches, a location.host websocket, and SameSite=Lax cookies. Static
//    assets outside /assets/ are served by Pages directly;
//    public/_routes.json lists the prefixes that reach this function.
//
// Configure ORIGIN_BASE in the Pages project settings to the hostname that
// resolves to nginx, e.g. https://origin.costan.io (a DNS record pointing at the
// server). WebSocket upgrades pass straight through: the Workers runtime
// forwards the Upgrade request and returns the 101 response unchanged.
//
// On a new deployment, confirm the /ws upgrade succeeds through this proxy
// (DevTools, Network, WS).
export async function onRequest(context) {
  const { request, env } = context;
  const incomingURL = new URL(request.url);
  if (incomingURL.pathname.startsWith("/assets/")) {
    return guardAsset(context);
  }
  const origin = env.ORIGIN_BASE;
  if (!origin) {
    return new Response("ORIGIN_BASE is not configured", { status: 500 });
  }
  const target = new URL(incomingURL.pathname + incomingURL.search, origin);
  // Cloning the request preserves method, headers (including Origin and the
  // session cookie), body, and the websocket Upgrade handshake.
  return fetch(new Request(target, request));
}

// Serve a static asset, refusing to let the SPA fallback masquerade as one.
// Asset URLs are content-hashed, so HTML at one means the file is missing from
// this deployment. `next()` runs the normal Pages asset pipeline.
async function guardAsset(context) {
  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (res.status === 200 && !type.startsWith("text/html")) {
    return res;
  }
  return new Response("not found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // A miss must not outlive the deploy that caused it.
      "cache-control": "no-store",
    },
  });
}
