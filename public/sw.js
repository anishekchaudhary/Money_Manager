const CACHE_PREFIX = "my-money-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const APP_ROUTES = new Set(["/", "/transactions", "/accounts", "/plan", "/goals", "/reports", "/alerts", "/settings"]);
const APP_ASSETS = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

function canonicalRoute(pathname) {
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return APP_ROUTES.has(path) ? path : null;
}

function offlinePage() {
  return new Response(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · My Money</title><body style="font:16px system-ui;margin:0;padding:48px 20px;background:#f5f6f2;color:#18271f"><main style="max-width:480px;margin:auto"><h1>This page is unavailable offline</h1><p>Reconnect to open it. Your saved financial data and pending entries have not been removed.</p><a href="/" style="color:#205d44">Go to dashboard</a></main></body></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.add("/");
    await Promise.allSettled([...APP_ROUTES].filter((route) => route !== "/").concat(APP_ASSETS).map((url) => cache.add(url)));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    const route = canonicalRoute(url.pathname);
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (route && response.ok && response.headers.get("Content-Type")?.includes("text/html") && !response.redirected) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(route, response.clone());
          } catch {
            // A full cache must not hide an otherwise successful online page.
          }
        }
        return response;
      } catch {
        if (route) {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(route);
          if (cached) return cached;
        }
        return offlinePage();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon") || url.pathname === "/manifest.webmanifest")) {
      try { await cache.put(request, response.clone()); } catch { /* Keep serving the online asset. */ }
    }
    return response;
  })());
});
