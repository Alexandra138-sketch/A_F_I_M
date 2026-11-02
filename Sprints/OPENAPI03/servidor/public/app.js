// Cliente: obtém, conserva e envia o token.
// O token fica numa variável do módulo: perde-se ao recarregar a página,
// mas não fica acessível em localStorage/sessionStorage.
import {
  lerConfiguracoes,
  guardarConfiguracoes
} from './configuracoes.js';

let sessao = null;

const $ = (id) => document.getElementById(id);

function mostrarErro(texto) { $('mensagens').textContent = texto; }
function limparErro() { $('mensagens').textContent = ''; }

function guardarRascunho() {
  const rascunho = {
    titulo: $('titulo-sugestao').value,
    descricao: $('descricao-sugestao').value,
    categoria: $('categoria-sugestao').value
  };

  sessionStorage.setItem(
    'rascunhoSugestao',
    JSON.stringify(rascunho)
  );
}

function restaurarRascunho() {
  const dados = sessionStorage.getItem('rascunhoSugestao');

  if (dados === null) {
    return;
  }

  try {
    const rascunho = JSON.parse(dados);

    $('titulo-sugestao').value = rascunho.titulo ?? '';
    $('descricao-sugestao').value = rascunho.descricao ?? '';

    const categorias = [
      'instalacoes',
      'ensino',
      'servicos',
      'atividades',
      'outra'
    ];

    if (categorias.includes(rascunho.categoria)) {
      $('categoria-sugestao').value = rascunho.categoria;
    }
  } catch {
    sessionStorage.removeItem('rascunhoSugestao');
  }
}

function limparRascunho() {
  sessionStorage.removeItem('rascunhoSugestao');
}


function aplicarTema(tema) {
  document.body.classList.toggle('tema-escuro', tema === 'escuro');
}

function aplicarOrdenacao() {
  const lista = $('lista-sugestoes');
  const itens = Array.from(lista.children);

  if ($('ordenacao').value === 'estado') {
    itens.sort((a, b) => {
      const estadoA = a.querySelector('.estado').textContent;
      const estadoB = b.querySelector('.estado').textContent;
      return estadoA.localeCompare(estadoB, 'pt-PT');
    });
  }

  for (const item of itens) {
    lista.append(item);
  }
}

const configuracoesIniciais = lerConfiguracoes();

$('tema').value = configuracoesIniciais.tema;
$('ordenacao').value = configuracoesIniciais.ordenacao;

aplicarTema(configuracoesIniciais.tema);

$('tema').addEventListener('change', () => {
  aplicarTema($('tema').value);

  guardarConfiguracoes({
    tema: $('tema').value,
    ordenacao: $('ordenacao').value
  });
});

$('ordenacao').addEventListener('change', () => {
  aplicarOrdenacao();

  guardarConfiguracoes({
    tema: $('tema').value,
    ordenacao: $('ordenacao').value
  });
});


// --- Autenticação ---
$('formulario').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErro();

  let resposta;

  try {
    resposta = await fetch('/v2/sessao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utilizador: $('utilizador').value,
        palavraPasse: $('palavraPasse').value,
      }),
    });
  } catch {
    mostrarErro('Não foi possível contactar o servidor. Verifique a ligação e tente novamente.');
    return;
  }

  const corpo = await resposta.json().catch(() => null);

  if (resposta.status === 200) {
    $('palavraPasse').value = '';
    await verificarSessao();
  } else if (resposta.status === 400 || resposta.status === 401) {
    mostrarErro(corpo?.mensagem ?? 'Não foi possível autenticar.');
  } else {
    mostrarErro('Ocorreu um erro inesperado no servidor.');
  }
});

// --- Sessão ---
function abrirSessao() {
  $('nome').textContent = sessao.nome;
  $('papel').textContent = sessao.papel;
  $('expiracao').textContent =
    new Date(sessao.expiracao).toLocaleTimeString('pt-PT');

  $('botao-sugestoes').textContent =
    sessao.papel === 'servicos'
      ? 'Todas as sugestões'
      : 'As minhas sugestões';

  $('entrada').hidden = true;
  $('sessao').hidden = false;

  const formularioSugestao = $('formulario-sugestao');

  formularioSugestao.hidden = sessao.papel !== 'aluno';
  
  if (sessao.papel === 'aluno') {
    restaurarRascunho();
  }

}

async function verificarSessao() {
  let resposta;

  try {
    resposta = await fetch('/v2/sessao');
  } catch {
    mostrarErro('Não foi possível contactar o servidor. Verifique a ligação e tente novamente.');
    return;
  }

  if (resposta.status === 200) {
    sessao = await resposta.json();
    limparErro();
    abrirSessao();
  } else if (resposta.status === 401) {
    sessao = null;
    $('sessao').hidden = true;
    $('entrada').hidden = false;
  } else {
    mostrarErro('Ocorreu um erro inesperado no servidor.');
  }
}

async function terminarSessao() {
  limparErro();

  try {
    const resposta = await fetch('/v2/sessao', {
      method: 'DELETE',
    });

    if (!resposta.ok) {
      mostrarErro('Não foi possível terminar a sessão.');
      return;
    }
  } catch {
    mostrarErro('Não foi possível contactar o servidor. Verifique a ligação e tente novamente.');
    return;
  }

  sessao = null;
  limparRascunho();

  $('lista-sugestoes').textContent = '';
  $('sessao').hidden = true;
  $('entrada').hidden = false;
  $('palavraPasse').value = '';
}

const formularioSugestao = $('formulario-sugestao');

formularioSugestao.addEventListener('input', guardarRascunho);
formularioSugestao.addEventListener('change', guardarRascunho);


formularioSugestao.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErro();

  if (sessao === null || sessao.papel !== 'aluno') {
    mostrarErro('Apenas os alunos podem enviar sugestões.');
    return;
  }

  let resposta;

  try {
    resposta = await fetch('/v2/sugestoes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        titulo: $('titulo-sugestao').value,
        descricao: $('descricao-sugestao').value,
        categoria: $('categoria-sugestao').value
      })
    });
  } catch {
    mostrarErro('Não foi possível contactar o servidor.');
    return;
  }

  const corpo = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    mostrarErro(
      corpo?.mensagem ?? 'Não foi possível criar a sugestão.'
    );
    return;
  }

  limparRascunho();
  formularioSugestao.reset();

  $('resultado-sugestao').textContent =
    'Sugestão enviada com sucesso!';

  $('botao-sugestoes').click();
});

$('botao-terminar').addEventListener('click', terminarSessao);

// --- Pedidos protegidos ---
// Devolve a resposta, ou null se o servidor respondeu 401 (sessão terminada).
async function pedidoAutenticado(url) {
  const resposta = await fetch(url);

  if (resposta.status === 401) {
    sessao = null;
    $('lista-sugestoes').textContent = '';
    $('sessao').hidden = true;
    $('entrada').hidden = false;

    mostrarErro('Sessão expirada. É necessária nova autenticação.');
    return null;
  }

  return resposta;
}

$('botao-sugestoes').addEventListener('click', async () => {
  limparErro();
  let resposta;
  try {
    resposta = await pedidoAutenticado('/v2/sugestoes');
  } catch {
    mostrarErro('Não foi possível contactar o servidor. Verifique a ligação e tente novamente.');
    return;
  }
  if (!resposta) return;
  if (!resposta.ok) { mostrarErro('Não foi possível obter as sugestões.'); return; }

  const { itens } = await resposta.json();
  const lista = $('lista-sugestoes');
  lista.textContent = '';

  for (const s of itens) {
    const li = document.createElement('li');
    const titulo = document.createElement('strong');
    const detalhe = document.createElement('span');
    const estado = document.createElement('span');
    // textContent (e não innerHTML): os dados da API nunca são interpretados como HTML
    titulo.textContent = s.titulo;
    detalhe.textContent = ` — ${s.categoria} — `;
    estado.className = 'estado';
    estado.textContent = s.estado;
    li.append(titulo, detalhe, estado);
    lista.append(li);
  }

  aplicarOrdenacao();
});

verificarSessao();