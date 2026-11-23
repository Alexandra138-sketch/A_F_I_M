// sw.js — provisório: sem estratégia de cache nem sincronização.
self.addEventListener('install', () => {
  console.log('[sw] install');
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  console.log('[sw] activate');
  e.waitUntil(self.clients.claim());
});
