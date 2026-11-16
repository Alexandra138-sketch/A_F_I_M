// sw.js
importScripts('/bd.js', '/sincronizacao.js');   // abrirBD(), … e executarSincronizacao()

const CACHE_INTERFACE = 'interface-v3';
const CACHE_PUBLICOS = 'dados-publicos';
const ETIQUETA_SYNC = 'sincronizar-sugestoes';

// Tem de listar TODOS os ficheiros que o index.html carrega, mais os que o SW importa.
const FICHEIROS = [
  '/', '/index.html', '/estilos.css', '/app.js', '/configuracoes.js',
  '/bd.js', '/sincronizacao.js'
];

// 11. Instalação (sem skipWaiting: a nova versão fica "à espera")
self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE_INTERFACE).then((cache) => cache.addAll(FICHEIROS)));
});

// 12. Ativação: apagar caches antigas (interface-v1, interface-v2, …)
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

// 13. Estratégias (as da API04). Os fetch() feitos pelo próprio SW NÃO passam
// por este evento, por isso o envio das pendentes e o pull vão sempre à rede.
self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;                       // não-GET: só rede
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/v2/categorias') {                   // cache + atualização em 2.º plano
    evento.respondWith(categorias(evento));
    return;
  }
  if (url.pathname.startsWith('/v2/')) return;               // resto da API (incl. /alteracoes): só rede
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

// ---- Sincronização ----

// Única variável global admitida: a promessa da sincronização em curso. Evita
// duas sincronizações em simultâneo dentro do mesmo arranque do SW. Se o SW for
// terminado, perde-se e não faz mal: nada que importe (pendentes, cursor) vive
// aqui, tudo está em IndexedDB.
let emCurso = null;

function sincronizar() {
  emCurso ??= executarSincronizacao().finally(() => { emCurso = null; });
  return emCurso;
}

async function avisarPaginas(mensagem) {
  for (const cliente of await self.clients.matchAll({ type: 'window' })) {
    cliente.postMessage(mensagem);
  }
}

// Erros lançados por executarSincronizacao() → mensagem para a página
function resultadoDeErro(e) {
  return { tipo: e && e.tipo ? e.tipo : 'erro-servidor', mensagem: String(e && e.message) };
}

// Chrome/Edge: o browser acorda o SW quando há rede, mesmo com o separador fechado.
self.addEventListener('sync', (evento) => {
  if (evento.tag !== ETIQUETA_SYNC) return;
  evento.waitUntil((async () => {
    try {
      const resultado = await sincronizar();
      await avisarPaginas(resultado);
      // sessao-expirada: resolve. Rejeitar só faria o browser repetir um
      // pedido que vai falhar até a pessoa entrar de novo; é a página que
      // volta a pedir sincronização depois de nova entrada.
    } catch (e) {
      await avisarPaginas(resultadoDeErro(e));
      // sem-rede / erro-servidor: rejeitar pede ao browser uma nova tentativa
      // (com intervalos crescentes). Em lastChance fica tudo nas pendentes.
      throw e;
    }
  })());
});

// Plano B (Firefox, Safari) e pedidos explícitos da página.
self.addEventListener('message', (evento) => {
  const dados = evento.data;
  if (!dados) return;
  if (dados.tipo === 'ativar') { self.skipWaiting(); return; }
  if (dados.tipo === 'sincronizar') {
    // waitUntil mantém o SW vivo até terminar; sem ele o browser podia
    // terminá-lo a meio do envio.
    evento.waitUntil((async () => {
      try {
        await avisarPaginas(await sincronizar());
      } catch (e) {
        await avisarPaginas(resultadoDeErro(e));   // aqui não se rejeita: a página decide
      }
    })());
  }
});
