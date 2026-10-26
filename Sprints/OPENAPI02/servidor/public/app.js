// Cliente: obtém, conserva e envia o token.
// O token fica numa variável do módulo: perde-se ao recarregar a página,
// mas não fica acessível em localStorage/sessionStorage.
let token = null;
let payload = null;      // só para apresentação; as decisões de segurança são do servidor
let temporizador = null;

const $ = (id) => document.getElementById(id);

function mostrarErro(texto) { $('mensagens').textContent = texto; }
function limparErro() { $('mensagens').textContent = ''; }

// base64url -> base64 -> bytes -> texto UTF-8 -> objeto
export function descodificarPayload(t) {
  const parte = t.split('.')[1];
  const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
  const binario = atob(base64);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8').decode(bytes)); // UTF-8: nomes acentuados
}

// --- Autenticação ---
$('formulario').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErro();

  let resposta;
  try {
    resposta = await fetch('/v2/tokens', {
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
    token = corpo.token;
    payload = descodificarPayload(token);
    $('palavraPasse').value = '';
    abrirSessao();
  } else if (resposta.status === 400 || resposta.status === 401) {
    // Mensagem do servidor, igual para «utilizador inexistente» e «palavra-passe errada»
    mostrarErro(corpo?.mensagem ?? 'Não foi possível autenticar.');
  } else {
    mostrarErro('Ocorreu um erro inesperado no servidor.');
  }
});

// --- Sessão ---
function abrirSessao() {
  $('nome').textContent = payload.nome;
  $('papel').textContent = payload.papel;
  $('expiracao').textContent = new Date(payload.exp * 1000).toLocaleTimeString('pt-PT');
  $('botao-sugestoes').textContent =
    payload.papel === 'servicos' ? 'Todas as sugestões' : 'As minhas sugestões';

  $('entrada').hidden = true;
  $('sessao').hidden = false;

  atualizarRestante();
  temporizador = setInterval(atualizarRestante, 1000);
}

function atualizarRestante() {
  const segundos = payload.exp - Math.floor(Date.now() / 1000);
  if (segundos <= 0) {
    terminarSessao('Sessão expirada. É necessária nova autenticação.');
    return;
  }
  const m = String(Math.floor(segundos / 60)).padStart(2, '0');
  const s = String(segundos % 60).padStart(2, '0');
  $('restante').textContent = `${m}:${s}`;
}

function terminarSessao(mensagem) {
  clearInterval(temporizador);
  token = null;      // o token é descartado, mas o servidor continua a aceitá-lo até exp
  payload = null;
  $('lista-sugestoes').textContent = '';
  $('sessao').hidden = true;
  $('entrada').hidden = false;
  if (mensagem) mostrarErro(mensagem); else limparErro();
}

$('botao-terminar').addEventListener('click', () => terminarSessao());

// --- Pedidos protegidos ---
// Devolve a resposta, ou null se o servidor respondeu 401 (sessão terminada).
async function pedidoAutenticado(url) {
  const resposta = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resposta.status === 401) {
    terminarSessao('Sessão expirada. É necessária nova autenticação.');
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
});