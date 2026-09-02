const CACHE = "wirzeit-v6";
const APP_ROOT = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const appUrl = (path = "/") => `${APP_ROOT}${path}`;
const CORE = [appUrl(), appUrl("/manifest.webmanifest"), appUrl("/icon-192.png"), appUrl("/icon-512.png"), appUrl("/apple-touch-icon.png")];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(appUrl()))));
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? { title: "WirZeit", body: "Es gibt etwas Neues in eurem Familienplaner." };
  event.waitUntil(self.registration.showNotification(data.title ?? "WirZeit", {
    body: data.body,
    icon: appUrl("/icon-192.png"),
    badge: appUrl("/favicon-32.png"),
    data: { url: data.url ?? appUrl() },
    tag: data.tag ?? "wirzeit",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL(event.notification.data?.url ?? "./", self.registration.scope).href));
});
