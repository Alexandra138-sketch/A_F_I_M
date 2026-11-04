// sw.js — passos 11 a 14
const CACHE_INTERFACE = 'interface-v1';
const CACHE_PUBLICOS = 'dados-publicos';

// AJUSTAR: tem de listar TODOS os ficheiros que o index.html carrega
const FICHEIROS = ['/', '/index.html', '/estilos.css', '/app.js', '/configuracoes.js', '/bd.js', '/pendentes.js'];

// 11. Instalação (sem skipWaiting: a nova versão fica "à espera", passo 14)
self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE_INTERFACE).then((cache) => cache.addAll(FICHEIROS)));
});

// 12. Ativação: apagar caches antigas
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_INTERFACE && nome !== CACHE_PUBLICOS)
          .map((nome) => caches.delete(nome))
      )
    )
  );
});

// 13. Estratégias
self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;                       // não-GET: só rede
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/v2/categorias') {                   // cache + atualização em 2.º plano
    evento.respondWith(categorias(evento));
    return;
  }
  if (url.pathname.startsWith('/v2/')) return;               // resto da API: só rede
  evento.respondWith(cachePrimeiro(pedido));                 // interface: cache primeiro
});

async function cachePrimeiro(pedido) {
  const guardada = await caches.match(pedido, { cacheName: CACHE_INTERFACE });
  if (guardada) return guardada;
  const resposta = await fetch(pedido);
  if (resposta.ok) {
    const cache = await caches.open(CACHE_INTERFACE);
    cache.put(pedido, resposta.clone());
  }
  return resposta;
}

async function categorias(evento) {
  const cache = await caches.open(CACHE_PUBLICOS);
  const guardada = await cache.match(evento.request);
  const atualizacao = fetch(evento.request).then((resposta) => {
    if (resposta.ok) cache.put(evento.request, resposta.clone());
    return resposta;
  });
  if (guardada) {
    evento.waitUntil(atualizacao.catch(() => {}));
    return guardada;
  }
  return atualizacao;
}

// 14. A página pede para ativar a nova versão
self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'ativar') self.skipWaiting();
});