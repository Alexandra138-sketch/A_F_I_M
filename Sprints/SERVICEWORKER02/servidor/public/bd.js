// bd.js — partilhado pela página e pelo service worker.
// Não usa window, document, localStorage nem alert: só indexedDB e crypto,
// que existem nos dois contextos. Carrega-se com <script> na página e com
// importScripts('/bd.js') no service worker.
const NOME_BD = 'sugestoes-bd';
const VERSAO_BD = 2;

// Uma ligação partilhada por contexto (a página e o SW têm cada um a sua).
let ligacao = null;

// A página pode registar aqui um aviso para quando a ligação é fechada porque
// outro contexto pediu uma versão mais nova da base (versionchange).
let aoFecharPorVersao = null;

function abrirBD() {
  if (ligacao) return Promise.resolve(ligacao);
  return new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(NOME_BD, VERSAO_BD);

    pedido.onupgradeneeded = (evento) => {
      const bd = pedido.result;
      const tx = pedido.transaction;

      if (evento.oldVersion < 1) {
        const sugestoes = bd.createObjectStore('sugestoes', { keyPath: 'id' });
        sugestoes.createIndex('porEstado', 'estado');
        sugestoes.createIndex('porData', 'dataCriacao');
        bd.createObjectStore('pendentes', { keyPath: 'idLocal', autoIncrement: true });
        bd.createObjectStore('meta', { keyPath: 'chave' });
      }

      if (evento.oldVersion < 2) {
        // Migração 1 → 2: índice novo e campos novos nas pendentes que já existam.
        // Cada pendente antiga recebe a sua chave de idempotência agora; como
        // nunca foi enviada com chave, não há risco de reutilizar uma já gasta.
        const pendentes = tx.objectStore('pendentes');
        pendentes.createIndex('porUtilizador', 'utilizador');
        pendentes.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          cursor.update({
            ...cursor.value,
            chave: crypto.randomUUID(),
            tentativas: 0,
            ultimaTentativa: null
          });
          cursor.continue();
        };
      }
    };

    // Outra ligação (aberta com a versão 1) está a impedir a atualização.
    pedido.onblocked = () => console.warn('sugestoes-bd: à espera que outra ligação feche');

    pedido.onsuccess = () => {
      ligacao = pedido.result;
      // Se outro contexto quiser a versão 2 (ou mais), esta ligação fecha-se
      // para não o bloquear. A seguinte chamada a abrirBD() abre de novo.
      ligacao.onversionchange = () => {
        ligacao.close();
        ligacao = null;
        if (typeof aoFecharPorVersao === 'function') aoFecharPorVersao();
      };
      resolver(ligacao);
    };
    pedido.onerror = () => rejeitar(pedido.error);
  });
}

// Executa "trabalho" numa transação e só resolve no evento "complete".
function executar(lojas, modo, trabalho) {
  return abrirBD().then((bd) => new Promise((resolver, rejeitar) => {
    const tx = bd.transaction(lojas, modo);
    const saida = trabalho(tx);
    tx.oncomplete = () => resolver(saida instanceof IDBRequest ? saida.result : saida);
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error);
  }));
}

// ---- Sugestões ----

// Apaga e volta a preencher numa ÚNICA transação
function substituirSugestoes(lista) {
  return executar(['sugestoes', 'meta'], 'readwrite', (tx) => {
    const loja = tx.objectStore('sugestoes');
    loja.clear();
    for (const s of lista) loja.put(s);
    const meta = tx.objectStore('meta');
    const pedido = meta.get('proprietario');
    pedido.onsuccess = () => {
      const dono = pedido.result;
      if (dono) { dono.atualizadoEm = new Date().toISOString(); meta.put(dono); }
    };
  });
}

function guardarSugestao(sugestao) {
  return executar('sugestoes', 'readwrite', (tx) => { tx.objectStore('sugestoes').put(sugestao); });
}

// 'recentes' -> índice porData decrescente; 'estado' -> índice porEstado
function lerSugestoes(ordenacao) {
  return executar('sugestoes', 'readonly', (tx) => {
    const porEstado = ordenacao === 'estado';
    const indice = tx.objectStore('sugestoes').index(porEstado ? 'porEstado' : 'porData');
    const lista = [];
    const cursor = indice.openCursor(null, porEstado ? 'next' : 'prev');
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) { lista.push(c.value); c.continue(); }
    };
    return lista;
  });
}

// ---- Pendentes (fila de saída) ----

// A chave de idempotência nasce AQUI, quando a pendente é criada, e fica
// guardada com ela. Todas as tentativas de envio usam a mesma chave.
function acrescentarPendente(dados, utilizador) {
  return executar('pendentes', 'readwrite', (tx) =>
    tx.objectStore('pendentes').add({
      utilizador,
      titulo: dados.titulo,
      descricao: dados.descricao,
      categoria: dados.categoria,
      criadaEm: new Date().toISOString(),
      erro: null,
      chave: crypto.randomUUID(),
      tentativas: 0,
      ultimaTentativa: null
    })
  );
}

function lerPendentes() {
  return executar('pendentes', 'readonly', (tx) => tx.objectStore('pendentes').getAll());
}

// Pelo índice porUtilizador, por ordem de idLocal, só as sem erro.
function lerPendentesDe(utilizador) {
  return executar('pendentes', 'readonly', (tx) => {
    const lista = [];
    const cursor = tx.objectStore('pendentes').index('porUtilizador').openCursor(IDBKeyRange.only(utilizador));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) { if (!c.value.erro) lista.push(c.value); c.continue(); }
    };
    return lista;
  }).then((lista) => lista.sort((a, b) => a.idLocal - b.idLocal));
}

// Conta todas as pendentes do utilizador (incluindo as com erro, que ainda
// estão no dispositivo e o utilizador precisa de ver).
function contarPendentes(utilizador) {
  return executar('pendentes', 'readonly', (tx) =>
    tx.objectStore('pendentes').index('porUtilizador').count(IDBKeyRange.only(utilizador))
  );
}

function registarTentativa(idLocal) {
  return executar('pendentes', 'readwrite', (tx) => {
    const loja = tx.objectStore('pendentes');
    const pedido = loja.get(idLocal);
    pedido.onsuccess = () => {
      const p = pedido.result;
      if (p) {
        p.tentativas = (p.tentativas || 0) + 1;
        p.ultimaTentativa = new Date().toISOString();
        loja.put(p);
      }
    };
  });
}

function marcarErro(idLocal, mensagem) {
  return executar('pendentes', 'readwrite', (tx) => {
    const loja = tx.objectStore('pendentes');
    const pedido = loja.get(idLocal);
    pedido.onsuccess = () => {
      if (pedido.result) { pedido.result.erro = mensagem; loja.put(pedido.result); }
    };
  });
}

function descartarPendente(idLocal) {
  return executar('pendentes', 'readwrite', (tx) => { tx.objectStore('pendentes').delete(idLocal); });
}

// Remove a pendente e guarda a sugestão criada: ÚNICA transação sobre as duas lojas
function confirmarPendente(idLocal, sugestao) {
  return executar(['pendentes', 'sugestoes'], 'readwrite', (tx) => {
    tx.objectStore('pendentes').delete(idLocal);
    tx.objectStore('sugestoes').put(sugestao);
  });
}

// ---- Cursor de sincronização (meta: cursor:<numeroAluno>) ----

function lerCursor(utilizador) {
  return executar('meta', 'readonly', (tx) => tx.objectStore('meta').get('cursor:' + utilizador))
    .then((registo) => (registo ? registo.valor : 0));
}

// As sugestões e o cursor novo gravam-se na MESMA transação: ou ficam as duas
// coisas, ou nenhuma. Se o browser fechasse entre as duas escritas, o cursor
// ficaria atrás (repete-se trabalho, inofensivo) ou à frente (perdem-se
// alterações para sempre, grave) — a transação única impede o segundo caso.
function aplicarAlteracoes(utilizador, alteracoes, cursor) {
  return executar(['sugestoes', 'meta'], 'readwrite', (tx) => {
    const loja = tx.objectStore('sugestoes');
    for (const s of alteracoes) loja.put(s);
    const meta = tx.objectStore('meta');
    meta.put({ chave: 'cursor:' + utilizador, valor: cursor });
    const pedido = meta.get('proprietario');
    pedido.onsuccess = () => {
      const dono = pedido.result;
      if (dono) { dono.atualizadoEm = new Date().toISOString(); meta.put(dono); }
    };
  });
}

// ---- Proprietário ----

function lerProprietario() {
  return executar('meta', 'readonly', (tx) => tx.objectStore('meta').get('proprietario'));
}

function guardarProprietario(sessao) {
  return executar('meta', 'readwrite', (tx) => {
    const meta = tx.objectStore('meta');
    const pedido = meta.get('proprietario');
    pedido.onsuccess = () => {
      const antigo = pedido.result;
      meta.put({
        chave: 'proprietario',
        utilizador: sessao.utilizador,
        nome: sessao.nome,
        papel: sessao.papel,
        expiracao: sessao.expiracao,
        atualizadoEm: antigo && antigo.utilizador === sessao.utilizador ? antigo.atualizadoEm : null,
      });
    };
  });
}

// Apaga tudo, incluindo os cursores (estão em meta).
function limparBD() {
  return executar(['sugestoes', 'pendentes', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('sugestoes').clear();
    tx.objectStore('pendentes').clear();
    tx.objectStore('meta').clear();
  });
}
