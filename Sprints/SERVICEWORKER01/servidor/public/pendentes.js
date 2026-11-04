// pendentes.js — envio das sugestões pendentes
let aEnviar = false;

// Devolve { estado }: 'concluido' | 'sessao-expirada' | 'sem-ligacao' | 'erro-servidor' | 'ocupado'
async function enviarPendentes(utilizador) {
  if (aEnviar) return { estado: 'ocupado' };
  aEnviar = true;
  try {
    const todas = await lerPendentes();   // já vêm por ordem de criação (idLocal)
    const minhas = todas.filter((p) => p.utilizador === utilizador && !p.erro);

    for (const p of minhas) {
      let resposta;
      try {
        resposta = await fetch('/v2/sugestoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ titulo: p.titulo, descricao: p.descricao, categoria: p.categoria }),
        });
      } catch {
        return { estado: 'sem-ligacao' };                      // para, mantém todas
      }

      if (resposta.status === 201) {
        await confirmarPendente(p.idLocal, await resposta.json());
      } else if (resposta.status === 400) {
        const erro = await resposta.json().catch(() => ({}));
        await marcarErro(p.idLocal, erro.mensagem || 'Pedido inválido.');   // continua nas seguintes
      } else if (resposta.status === 401) {
        return { estado: 'sessao-expirada' };                  // para, mantém todas
      } else {
        return { estado: 'erro-servidor' };                    // outro código: para e mantém
      }
    }
    return { estado: 'concluido' };
  } finally {
    aEnviar = false;
  }
}