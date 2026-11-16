
const configuracoesPorOmissao = {
  tema: 'claro',
  ordenacao: 'recentes'
};

export function lerConfiguracoes() {
  const dados = localStorage.getItem('configuracoes');

  if (dados === null) {
    return { ...configuracoesPorOmissao };
  }

  try {
    const configuracoes = JSON.parse(dados);

    if (
      configuracoes.tema !== 'claro' &&
      configuracoes.tema !== 'escuro'
    ) {
      return { ...configuracoesPorOmissao };
    }

    if (
      configuracoes.ordenacao !== 'recentes' &&
      configuracoes.ordenacao !== 'estado'
    ) {
      return { ...configuracoesPorOmissao };
    }

    return {
      tema: configuracoes.tema,
      ordenacao: configuracoes.ordenacao
    };
  } catch {
    return { ...configuracoesPorOmissao };
  }
}

export function guardarConfiguracoes(configuracoes) {
  localStorage.setItem(
    'configuracoes',
    JSON.stringify(configuracoes)
  );
}
