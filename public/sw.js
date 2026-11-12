"use strict";

const CACHE_NAME = "nabapp-shell-v11";
const APP_SHELL = [
  "/",
  "/styles.css",
  "/storage.js",
  "/crypto.js",
  "/pwa.js",
  "/account-storage.js",
  "/identity-backup.js",
  "/app.js",
  "/manifest.json",
  "/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("nabapp-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.startsWith("/api/") || url.pathname === "/ws") return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && (request.mode === "navigate" || APP_SHELL.includes(url.pathname))) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("/");
        if (shell) return shell;
      }
      throw error;
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Nabapp", body: "Yeni bir şifreli mesajınız var." };
  try {
    if (event.data) data = event.data.json();
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Nabapp", {
      body: data.body || "Yeni bir mesaj aldınız.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: "nabapp-message",
      renotify: true,
    })
  );
});