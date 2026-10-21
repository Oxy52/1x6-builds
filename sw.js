// Минимальный service worker: нужен, чтобы сайт можно было установить как приложение.
// Ничего не кеширует — всегда свежая версия сайта.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
