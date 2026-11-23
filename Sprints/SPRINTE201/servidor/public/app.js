// app.js — página. Neste sprint: só regista o service worker.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('Service worker registado, âmbito:', reg.scope))
      .catch((err) => console.error('Falha ao registar o service worker:', err));
  });
}
