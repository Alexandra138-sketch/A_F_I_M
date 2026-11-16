// sincronizacao.js — só usado pelo service worker (importScripts).
// Depende das funções globais de bd.js.
//
// Ordem: 1) push (esvaziar a fila de saída)  2) pull (o que mudou no servidor).
// O pull só corre se TODAS as pendentes foram tratadas, para nunca escrever
// por cima de alterações locais que ainda não saíram do dispositivo.

function erroSincronizacao(tipo, mensagem) {
  const e = new Error(mensagem);
  e.tipo = tipo;
  return e;
}

// Devolve { tipo: 'sincronizado' | 'sessao-expirada', ... } ou lança
// um erro com .tipo 'sem-rede' | 'erro-servidor'.
async function executarSincronizacao() {
  // O SW não lê o cookie. Sabe de quem são as pendentes através do
  // proprietario guardado em meta, e só envia as dele.
  const dono = await lerProprietario();
  if (!dono || new Date(dono.expiracao) <= new Date()) {
    // Sem sessão válida nem sequer se tenta: seria um 401 garantido.
    const porEnviar = dono ? await contarPendentes(dono.utilizador) : 0;
    return { tipo: 'sessao-expirada', porEnviar };
  }
  const utilizador = dono.utilizador;

  let enviadas = 0;
  let recusadas = 0;

  // --- PUSH: uma de cada vez, pela ordem de idLocal ---
  for (const p of await lerPendentesDe(utilizador)) {
    await registarTentativa(p.idLocal);          // antes de enviar: conta mesmo que falhe

    let resposta;
    try {
      resposta = await fetch('/v2/sugestoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': p.chave             // a mesma em todas as tentativas
        },
        credentials: 'same-origin',              // o browser junta o cookie; o SW não o vê
        body: JSON.stringify({ titulo: p.titulo, descricao: p.descricao, categoria: p.categoria })
      });
    } catch {
      throw erroSincronizacao('sem-rede', 'Sem rede ou resposta perdida');   // para; mantém todas
    }

    if (resposta.status === 201) {               // criada, ou repetição reconhecida
      await confirmarPendente(p.idLocal, await resposta.json());
      enviadas++;
    } else if (resposta.status === 400 || resposta.status === 409) {
      // O pedido está errado: repeti-lo não adianta. Marca e segue.
      const corpo = await resposta.json().catch(() => ({}));
      await marcarErro(p.idLocal, corpo.mensagem || 'Pedido recusado pelo servidor.');
      recusadas++;
    } else if (resposta.status === 401) {
      return { tipo: 'sessao-expirada', porEnviar: await contarPendentes(utilizador) };
    } else {
      // 5xx (ou qualquer outro código inesperado): talvez passageiro. Para.
      throw erroSincronizacao('erro-servidor', 'Resposta ' + resposta.status);
    }
  }

  // --- PULL: só o que mudou desde o cursor ---
  const cursor = await lerCursor(utilizador);
  let respostaPull;
  try {
    respostaPull = await fetch('/v2/sugestoes/alteracoes?desde=' + cursor, { credentials: 'same-origin' });
  } catch {
    throw erroSincronizacao('sem-rede', 'Sem rede no pull');
  }

  let recebidas = 0;
  if (respostaPull.status === 200) {
    const { alteracoes, cursor: novoCursor } = await respostaPull.json();
    await aplicarAlteracoes(utilizador, alteracoes, novoCursor);
    recebidas = alteracoes.length;
  } else if (respostaPull.status === 401) {
    return { tipo: 'sessao-expirada', porEnviar: await contarPendentes(utilizador) };
  } else {
    throw erroSincronizacao('erro-servidor', 'Resposta ' + respostaPull.status + ' no pull');
  }

  return {
    tipo: 'sincronizado',
    enviadas,
    recusadas,
    recebidas,
    porEnviar: await contarPendentes(utilizador)
  };
}
