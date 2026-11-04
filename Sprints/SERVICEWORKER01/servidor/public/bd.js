// bd.js — passos 15 a 17 (só a página usa; o service worker não lhe toca)
const NOME_BD = 'sugestoes-bd';
const VERSAO_BD = 1;

function abrirBD() {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOME_BD, VERSAO_BD);
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      const sugestoes = bd.createObjectStore('sugestoes', { keyPath: 'id' });
      sugestoes.createIndex('porEstado', 'estado');
      sugestoes.createIndex('porData', 'dataCriacao');
      bd.createObjectStore('pendentes', { keyPath: 'idLocal', autoIncrement: true });
      bd.createObjectStore('meta', { keyPath: 'chave' });
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

// Executa "trabalho" numa transação e só resolve no evento "complete".
function executar(lojas, modo, trabalho) {
  return abrirBD().then((bd) => new Promise((resolve, reject) => {
    const tx = bd.transaction(lojas, modo);
    const saida = trabalho(tx);
    tx.oncomplete = () => {
      bd.close();
      resolve(saida instanceof IDBRequest ? saida.result : saida);
    };
    tx.onerror = () => { bd.close(); reject(tx.error); };
    tx.onabort = () => { bd.close(); reject(tx.error); };
  }));
}

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

function acrescentarPendente(dados, utilizador) {
  return executar('pendentes', 'readwrite', (tx) =>
    tx.objectStore('pendentes').add({
      utilizador,
      titulo: dados.titulo,
      descricao: dados.descricao,
      categoria: dados.categoria,
      criadaEm: new Date().toISOString(),
      erro: null,
    })
  );
}

function lerPendentes() {
  return executar('pendentes', 'readonly', (tx) => tx.objectStore('pendentes').getAll());
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
        utilizador: sessao.utilizador,   // AJUSTAR se a Sessao tiver outros nomes
        nome: sessao.nome,
        papel: sessao.papel,
        expiracao: sessao.expiracao,
        atualizadoEm: antigo && antigo.utilizador === sessao.utilizador ? antigo.atualizadoEm : null,
      });
    };
  });
}

function limparBD() {
  return executar(['sugestoes', 'pendentes', 'meta'], 'readwrite', (tx) => {
    tx.objectStore('sugestoes').clear();
    tx.objectStore('pendentes').clear();
    tx.objectStore('meta').clear();
  });
}