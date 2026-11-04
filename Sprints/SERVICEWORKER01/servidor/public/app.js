// Cliente: estados da interface, service worker e dados locais em IndexedDB.
// As funções de bd.js e pendentes.js são globais (carregados antes, como scripts normais).
import {
  lerConfiguracoes,
  guardarConfiguracoes
} from './configuracoes.js';

const CHAVE_RASCUNHO = 'rascunhoSugestao';
const ESTADOS = ['a-verificar', 'sem-sessao', 'com-sessao', 'sem-ligacao'];

let sessao = null;           // última Sessao conhecida
let utilizadorDados = null;  // utilizador a quem pertence o que se mostra
let temporizador = null;

const $ = (id) => document.getElementById(id);

function mostrarMensagem(texto) { $('mensagem-geral').textContent = texto; }
function limparMensagem() { $('mensagem-geral').textContent = ''; }

function hora(data) {
  if (!data) return '—';
  return new Date(data).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

// --- Rascunho (sessionStorage) ---
function guardarRascunho() {
  sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({
    titulo: $('campo-titulo').value,
    descricao: $('campo-descricao').value,
    categoria: $('campo-categoria').value
  }));
}

function restaurarRascunho() {
  const dados = sessionStorage.getItem(CHAVE_RASCUNHO);
  if (dados === null) return;
  try {
    const rascunho = JSON.parse(dados);
    $('campo-titulo').value = rascunho.titulo ?? '';
    $('campo-descricao').value = rascunho.descricao ?? '';
    const existe = Array.from($('campo-categoria').options)
      .some((o) => o.value === rascunho.categoria);
    if (existe) $('campo-categoria').value = rascunho.categoria;
  } catch {
    sessionStorage.removeItem(CHAVE_RASCUNHO);
  }
}

function limparRascunho() { sessionStorage.removeItem(CHAVE_RASCUNHO); }

// --- Tema e ordenação (localStorage, via configuracoes.js) ---
function aplicarTema(tema) {
  document.body.classList.toggle('tema-escuro', tema === 'escuro');
}

function guardarDefinicoes() {
  guardarConfiguracoes({ tema: $('tema').value, ordenacao: $('ordenacao').value });
}

const configuracoesIniciais = lerConfiguracoes();
$('tema').value = configuracoesIniciais.tema;
$('ordenacao').value = configuracoesIniciais.ordenacao;
aplicarTema(configuracoesIniciais.tema);

$('tema').addEventListener('change', () => {
  aplicarTema($('tema').value);
  guardarDefinicoes();
});

// 18. A ordenação volta a ler a IndexedDB, sem novo pedido ao servidor
$('ordenacao').addEventListener('change', () => {
  guardarDefinicoes();
  desenharLista();
});

// --- 5. Estados: ÚNICO sítio onde o estado muda ---
function mudarEstado(estado, mensagem = '') {
  document.body.dataset.estado = estado;
  for (const e of ESTADOS) $('area-' + e).hidden = (e !== estado);
  $('barra-sessao').hidden = !(estado === 'com-sessao' || estado === 'sem-ligacao');
  $('botao-sair').disabled = (estado === 'sem-ligacao');
  $('explicacao-sair').hidden = (estado !== 'sem-ligacao');
  $('bloco-dados').hidden = (estado !== 'com-sessao');   // em sem-ligacao decide mostrarSemLigacao()
  $('estado-ligacao').textContent = estado === 'sem-ligacao' ? 'Sem ligação ao servidor.' : '';
  mostrarMensagem(mensagem);
  if (estado !== 'com-sessao') pararContagem();
}

function prepararBloco(papel) {
  $('form-nova').hidden = (papel !== 'aluno');
  $('bloco-dados').querySelector('h2').textContent =
    papel === 'servicos' ? 'Todas as sugestões' : 'As minhas sugestões';
}

// --- 6. Arranque: perguntar ao servidor se há sessão ---
async function verificarSessao() {
  mudarEstado('a-verificar');
  try {
    const resposta = await fetch('/v2/sessao');
    if (resposta.status === 200) {
      await entrarEmComSessao(await resposta.json());
    } else if (resposta.status === 401) {
      mudarEstado('sem-sessao');
    } else {
      mudarEstado('sem-sessao', 'Ocorreu um erro inesperado no servidor.');
    }
  } catch {
    await mostrarSemLigacao();
  }
}

async function entrarEmComSessao(nova) {
  const dono = await lerProprietario();
  if (dono && dono.utilizador !== nova.utilizador) {
    await limparBD();                 // a cópia local era de outra pessoa
    limparRascunho();
    $('form-nova').reset();
  }
  await guardarProprietario(nova);    // 17
  sessao = nova;
  utilizadorDados = nova.utilizador;

  mudarEstado('com-sessao');
  $('nome').textContent = nova.nome;
  $('papel').textContent = nova.papel;
  prepararBloco(nova.papel);
  if (nova.papel === 'aluno') restaurarRascunho();
  iniciarContagem(nova.expiracao);

  await desenharLista();
  if (await sincronizarPendentes()) await carregarLista();
}

// --- 7. Entrar ---
async function entrar(evento) {
  evento.preventDefault();
  const botao = $('botao-entrar');
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'A entrar…';
  $('mensagem-entrada').textContent = '';

  try {
    const resposta = await fetch('/v2/sessao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utilizador: $('campo-utilizador').value,
        palavraPasse: $('campo-palavra-passe').value
      })
    });
    const corpo = await resposta.json().catch(() => null);

    if (resposta.status === 200) {
      $('campo-palavra-passe').value = '';
      await entrarEmComSessao(corpo);
      $('titulo-sessao').focus();
    } else if (resposta.status === 400 || resposta.status === 401) {
      $('mensagem-entrada').textContent = corpo?.mensagem ?? 'Não foi possível autenticar.';
      $('campo-palavra-passe').value = '';
      $('campo-palavra-passe').focus();
    } else {
      $('mensagem-entrada').textContent = 'Ocorreu um erro inesperado no servidor.';
    }
  } catch {
    await mostrarSemLigacao('Sem ligação: não é possível entrar.');
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

// --- 8. Expiração (não apaga rascunho, pendentes nem cópia local) ---
function iniciarContagem(expiracao) {
  pararContagem();
  const fim = new Date(expiracao).getTime();
  const atualizar = () => {
    const resta = Math.max(0, Math.round((fim - Date.now()) / 1000));
    $('tempo-restante').textContent = `${Math.floor(resta / 60)} min ${resta % 60} s`;
    if (resta === 0) sessaoExpirada();
  };
  temporizador = setInterval(atualizar, 1000);
  atualizar();
}

function pararContagem() {
  clearInterval(temporizador);
  temporizador = null;
}

function sessaoExpirada(mensagem = 'A sessão expirou. Entre de novo.') {
  sessao = null;
  mudarEstado('sem-sessao', mensagem);
}

// --- 9. Terminar sessão ---
function perguntar() {
  return new Promise((resolve) => {
    const dialogo = $('dialogo-sair');
    dialogo.returnValue = '';
    dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'confirmar'), { once: true });
    dialogo.showModal();
  });
}

async function terminarSessao() {
  limparMensagem();
  const pendentes = (await lerPendentes()).filter((p) => p.utilizador === utilizadorDados);
  if (pendentes.length > 0) {
    $('texto-confirmar').textContent =
      `Há ${pendentes.length} sugestões por enviar, que serão apagadas. Terminar sessão?`;
    if (!(await perguntar())) return;
  }

  try {
    const resposta = await fetch('/v2/sessao', { method: 'DELETE' });
    if (resposta.status === 204) {
      await limparBD();
      limparRascunho();
      $('form-nova').reset();
      $('lista-sugestoes').textContent = '';
      sessao = null;
      utilizadorDados = null;
      mudarEstado('sem-sessao');
      $('campo-utilizador').focus();
    } else {
      mostrarMensagem('Não foi possível terminar a sessão.');
    }
  } catch {
    await mostrarSemLigacao();
  }
}

// --- 20. Sem ligação: só mostra a cópia se houver proprietário e a sessão dele não tiver expirado ---
async function mostrarSemLigacao(mensagem = '') {
  mudarEstado('sem-ligacao', mensagem);
  const dono = await lerProprietario();
  if (dono && new Date(dono.expiracao) > new Date()) {
    utilizadorDados = dono.utilizador;
    prepararBloco(dono.papel);
    $('nota-dados').textContent =
      `Cópia de ${hora(dono.atualizadoEm)} (${dono.nome}) — pode estar desatualizada`;
    $('bloco-dados').hidden = false;
    await desenharLista();
  }
}

// --- 18. A lista mostra-se SEMPRE a partir da IndexedDB ---
async function carregarLista() {
  try {
    const resposta = await fetch('/v2/sugestoes');
    if (resposta.status === 200) {
      const { itens } = await resposta.json();
      await substituirSugestoes(itens);
      $('nota-dados').textContent = 'Atualizado às ' + hora(new Date());
    } else if (resposta.status === 401) {
      sessaoExpirada('A sessão expirou. Entre de novo.');
      return;
    } else {
      mostrarMensagem('Não foi possível obter as sugestões.');
    }
  } catch {
    await mostrarSemLigacao();
    return;
  }
  await desenharLista();
}

// --- 19. Pendentes no topo, depois as sugestões (só textContent) ---
async function desenharLista() {
  const lista = $('lista-sugestoes');
  lista.replaceChildren();

  const pendentes = (await lerPendentes()).filter((p) => p.utilizador === utilizadorDados);
  for (const p of pendentes) {
    const li = document.createElement('li');
    li.className = 'pendente';
    const texto = document.createElement('span');
    texto.textContent = `${p.titulo} — ${p.erro ? 'Erro: ' + p.erro : 'Por enviar'}`;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = 'Descartar';
    botao.addEventListener('click', async () => {
      await descartarPendente(p.idLocal);
      await desenharLista();
    });
    li.append(texto, botao);
    lista.append(li);
  }

  for (const s of await lerSugestoes($('ordenacao').value)) {
    const li = document.createElement('li');
    const titulo = document.createElement('strong');
    const detalhe = document.createElement('span');
    const estado = document.createElement('span');
    titulo.textContent = s.titulo;
    detalhe.textContent = ` — ${s.categoria} — `;
    estado.className = 'estado';
    estado.textContent = s.estado;
    li.append(titulo, detalhe, estado);
    lista.append(li);
  }
}

// --- 22. Envio das pendentes ---
// Devolve true se se pode continuar (ex.: carregar a lista), false se o estado mudou.
async function sincronizarPendentes() {
  const resultado = await enviarPendentes(utilizadorDados);
  if (resultado.estado === 'sessao-expirada') {
    const n = (await lerPendentes()).filter((p) => p.utilizador === utilizadorDados).length;
    sessaoExpirada(`Há ${n} sugestões por enviar. Entre de novo para as enviar.`);
    return false;
  }
  if (resultado.estado === 'sem-ligacao') {
    await mostrarSemLigacao();
    return false;
  }
  return true;
}

// --- 21. Categorias (servidas pelo service worker) e nova sugestão ---
async function carregarCategorias() {
  const select = $('campo-categoria');
  try {
    const resposta = await fetch('/v2/categorias');
    if (!resposta.ok) throw new Error('categorias');
    const categorias = await resposta.json();
    select.replaceChildren();
    for (const c of categorias) {
      const opcao = document.createElement('option');
      opcao.value = c.codigo;
      opcao.textContent = c.descricao;
      select.append(opcao);
    }
    $('botao-nova').disabled = false;
    $('mensagem-nova').textContent = '';
    restaurarRascunho();
  } catch {
    $('botao-nova').disabled = true;
    $('mensagem-nova').textContent =
      'Sem categorias disponíveis: não é possível criar sugestões agora.';
  }
}

async function criarSugestaoSubmetida(evento) {
  evento.preventDefault();
  $('mensagem-nova').textContent = '';
  if (utilizadorDados === null) return;

  const dados = {                      // apenas estes 3 campos
    titulo: $('campo-titulo').value,
    descricao: $('campo-descricao').value,
    categoria: $('campo-categoria').value
  };

  if (document.body.dataset.estado === 'com-sessao') {
    try {
      const resposta = await fetch('/v2/sugestoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      if (resposta.status === 201) {
        await guardarSugestao(await resposta.json());
        limparRascunho();
        $('form-nova').reset();
        $('mensagem-nova').textContent = 'Sugestão enviada com sucesso!';
        await desenharLista();
      } else if (resposta.status === 401) {
        sessaoExpirada('A sessão expirou. Entre de novo.');
      } else {
        const corpo = await resposta.json().catch(() => null);
        $('mensagem-nova').textContent = corpo?.mensagem ?? 'Não foi possível criar a sugestão.';
      }
      return;
    } catch {
      // erro de rede: guarda como pendente (abaixo)
    }
  }

  await acrescentarPendente(dados, utilizadorDados);
  limparRascunho();
  $('form-nova').reset();
  if (document.body.dataset.estado === 'com-sessao') {
    await mostrarSemLigacao();
  } else {
    await desenharLista();
  }
  $('mensagem-nova').textContent =
    'Sem ligação: a sugestão ficou guardada e será enviada quando houver ligação.';
}

// --- 14. Service worker e atualização da aplicação ---
async function registarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const registo = await navigator.serviceWorker.register('/sw.js');

  const mostrarSeEspera = () => {
    if (registo.waiting && navigator.serviceWorker.controller) {
      $('botao-atualizar').hidden = false;
    }
  };
  mostrarSeEspera();
  registo.addEventListener('updatefound', () => {
    const novo = registo.installing;
    novo.addEventListener('statechange', () => {
      if (novo.state === 'installed') mostrarSeEspera();
    });
  });

  $('botao-atualizar').addEventListener('click', () => {
    if (registo.waiting) registo.waiting.postMessage({ tipo: 'ativar' });
  });

  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregou) return;
    recarregou = true;
    location.reload();
  });
}

// --- Ligação de eventos e arranque ---
$('form-entrar').addEventListener('submit', entrar);
$('botao-sair').addEventListener('click', terminarSessao);
$('form-nova').addEventListener('submit', criarSugestaoSubmetida);
$('form-nova').addEventListener('input', guardarRascunho);
$('form-nova').addEventListener('change', guardarRascunho);

// 10. online: repete a verificação da sessão; offline só atualiza a indicação
window.addEventListener('online', () => {
  carregarCategorias();
  verificarSessao();
});
window.addEventListener('offline', () => {
  $('estado-ligacao').textContent = 'Sem ligação à rede.';
});

registarServiceWorker().catch(() => {});
carregarCategorias();
verificarSessao();