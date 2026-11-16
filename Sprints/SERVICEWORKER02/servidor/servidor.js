// Arranque, rotas e tratamento de erros.
// Arrancar com: node --env-file=.env servidor.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  criarToken,
  criarSessao,
  terminarSessao,
  exigirToken,
  erro
} from './autenticacao.js';

const app = express();
app.use(express.json());

const sugestoes = JSON.parse(
  readFileSync(new URL('./dados/sugestoes.json', import.meta.url), 'utf-8')
);

const novasSugestoes = [];

// ---- API05: contador de versões ----
// Cresce sempre (nunca desce e nunca se repete), por isso serve de cursor:
// o cliente pede "tudo o que tem versao > cursor". As sugestões do ficheiro
// não têm o campo, por isso recebem-no no arranque, por ordem de id.
let contadorVersao = 0;
for (const s of [...sugestoes].sort((a, b) => a.id - b.id)) {
  s.versao = ++contadorVersao;
}

// ---- API05: variáveis de ensaio (desligadas por omissão) ----
const SIMULAR_PERDA_RESPOSTA = process.env.SIMULAR_PERDA_RESPOSTA === '1';
let simular503Restantes = Number(process.env.SIMULAR_503) || 0;

// O contrato fica na pasta acima de servidor/
const contrato = readFileSync(new URL('../sugestoes.openapi.yaml', import.meta.url), 'utf-8');

// Publicação do contrato
app.get('/v2/openapi.yaml', (req, res) => {
  res.type('application/yaml').send(contrato);
});

const CATEGORIAS = [
  { codigo: 'instalacoes', descricao: 'Instalações' },
  { codigo: 'ensino', descricao: 'Ensino' },
  { codigo: 'servicos', descricao: 'Serviços' },
  { codigo: 'atividades', descricao: 'Atividades' },
  { codigo: 'outra', descricao: 'Outra' }
];

app.get('/v2/categorias', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  return res.status(200).json(CATEGORIAS);
});

// 11. criarToken (pública)
app.post('/v2/tokens', criarToken);

// 7. iniciar sessão com cookie
app.post('/v2/sessao', criarSessao);

app.delete('/v2/sessao', terminarSessao);

// ---- API05: idempotência ----
// Estrutura indexada por numeroAluno + chave. Guardar por utilizador evita que
// a chave de um aluno colida com (ou revele) a de outro.
// Em memória: perde-se se o servidor reiniciar (ver registo.md, reflexão 4).
const VALIDADE_CHAVES_MS = 24 * 60 * 60 * 1000;   // 24 horas
const chavesIdempotencia = new Map();             // "numeroAluno|chave" -> registo

const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function indice(numeroAluno, chave) {
  return `${numeroAluno}|${chave.toLowerCase()}`;
}

function lerChave(numeroAluno, chave) {
  const registo = chavesIdempotencia.get(indice(numeroAluno, chave));
  if (!registo) return null;
  if (registo.expiraEm <= Date.now()) {            // expirada: como se não existisse
    chavesIdempotencia.delete(indice(numeroAluno, chave));
    return null;
  }
  return registo;
}

// Limpeza periódica; unref() para não impedir o processo de terminar.
setInterval(() => {
  const agora = Date.now();
  for (const [k, r] of chavesIdempotencia) if (r.expiraEm <= agora) chavesIdempotencia.delete(k);
}, 60 * 60 * 1000).unref();

// O "corpo" que conta para comparar é só o que o servidor lê.
function corpoNormalizado(corpo) {
  return JSON.stringify([corpo.titulo, corpo.descricao, corpo.categoria]);
}

app.post('/v2/sugestoes', exigirToken, (req, res) => {
  res.set('Cache-Control', 'no-store');

  // Ensaio: os próximos n POST recebem 503, sem criar nada.
  if (simular503Restantes > 0) {
    simular503Restantes--;
    res.set('Retry-After', '2');
    return res.status(503).json(erro(503, 'Serviço temporariamente indisponível'));
  }

  if (req.utilizador.papel !== 'aluno') {
    return res.status(403).json(
      erro(403, 'Apenas os alunos podem criar sugestões')
    );
  }

  // Só se leem titulo, descricao e categoria: um numeroAluno no corpo é ignorado.
  const corpo = req.body && typeof req.body === 'object' ? req.body : {};

  // --- Idempotency-Key (opcional) ---
  const chave = req.get('Idempotency-Key');
  if (chave !== undefined && !PADRAO_UUID.test(chave)) {
    return res.status(400).json(erro(400, 'Cabeçalho Idempotency-Key inválido', [
      { campo: 'Idempotency-Key', problema: 'deve ser um UUID' }
    ]));
  }

  if (chave !== undefined) {
    const guardada = lerChave(req.utilizador.sub, chave);
    if (guardada) {
      if (guardada.corpo !== corpoNormalizado(corpo)) {
        // Mesma chave, outro pedido: é um erro do cliente. Nem criar outra
        // sugestão (a chave deixaria de identificar uma operação), nem devolver
        // a resposta antiga (esconderia que o pedido novo foi ignorado).
        return res.status(409).json(
          erro(409, 'Esta Idempotency-Key já foi usada com um corpo diferente')
        );
      }
      res.set('Idempotent-Replayed', 'true');
      res.set('Location', guardada.location);
      return res.status(guardada.codigo).json(guardada.resposta);
    }
  }

  // --- Validação (um 400 nunca fica guardado) ---
  const detalhes = [];
  if (
    typeof corpo.titulo !== 'string' ||
    corpo.titulo.length < 10 ||
    corpo.titulo.length > 120
  ) {
    detalhes.push({ campo: 'titulo', problema: 'deve ter entre 10 e 120 caracteres' });
  }
  if (
    typeof corpo.descricao !== 'string' ||
    corpo.descricao.length < 20 ||
    corpo.descricao.length > 2000
  ) {
    detalhes.push({ campo: 'descricao', problema: 'deve ter entre 20 e 2000 caracteres' });
  }
  if (!CATEGORIAS.some((c) => c.codigo === corpo.categoria)) {
    detalhes.push({ campo: 'categoria', problema: 'deve ser uma das cinco categorias' });
  }
  if (detalhes.length > 0) {
    return res.status(400).json(erro(400, 'Dados da sugestão inválidos', detalhes));
  }

  // --- Criar ---
  const id = Math.max(
    0,
    ...sugestoes.map((s) => Number(s.id) || 0),
    ...novasSugestoes.map((s) => s.id)
  ) + 1;

  const agora = new Date().toISOString();

  const novaSugestao = {
    id: id,
    titulo: corpo.titulo,
    descricao: corpo.descricao,
    categoria: corpo.categoria,
    numeroAluno: req.utilizador.sub,
    estado: 'submetida',
    dataCriacao: agora,
    dataAtualizacao: agora,
    dataResolucao: null,
    versao: ++contadorVersao
  };

  novasSugestoes.push(novaSugestao);

  const location = `/v2/sugestoes/${id}`;

  // A chave só é guardada DEPOIS de a sugestão existir. Se fosse antes e o
  // servidor falhasse entre as duas operações, a repetição receberia uma
  // resposta guardada de uma sugestão que nunca foi criada.
  if (chave !== undefined) {
    chavesIdempotencia.set(indice(req.utilizador.sub, chave), {
      corpo: corpoNormalizado(corpo),
      codigo: 201,
      location,
      resposta: novaSugestao,
      expiraEm: Date.now() + VALIDADE_CHAVES_MS
    });

    // Ensaio: a sugestão e a chave ficam guardadas, mas a resposta perde-se.
    if (SIMULAR_PERDA_RESPOSTA) {
      console.log(`[ensaio] resposta perdida para a chave ${chave} (sugestão ${id} criada)`);
      req.socket.destroy();
      return;
    }
  }

  res.location(location);
  return res.status(201).json(novaSugestao);
});

app.get('/v2/sessao', exigirToken, (req, res) => {
  res.set('Cache-Control', 'no-store');

  return res.status(200).json({
    utilizador: req.utilizador.sub,
    nome: req.utilizador.nome,
    papel: req.utilizador.papel,
    expiracao: new Date(req.utilizador.exp * 1000).toISOString()
  });
});

function sugestoesVisiveis({ papel, sub }) {
  const todas = [...sugestoes, ...novasSugestoes];
  // Aluno: só as suas. Serviços: todas.
  return papel === 'aluno' ? todas.filter((s) => s.numeroAluno === sub) : todas;
}

// 1. listarSugestoes (protegida; aluno e serviços)
app.get('/v2/sugestoes', exigirToken, (req, res) => {
  const itens = sugestoesVisiveis(req.utilizador);

  res
    .set('Cache-Control', 'private, no-cache') // depende da identidade: nunca public
    .json({ pagina: 1, tamanhoPagina: 20, total: itens.length, itens });
});

// ---- API05: o que mudou desde o cursor ----
app.get('/v2/sugestoes/alteracoes', exigirToken, (req, res) => {
  // private + no-store: depende da identidade e o cursor tem de ser sempre fresco.
  res.set('Cache-Control', 'private, no-store');

  const bruto = req.query.desde;
  if (typeof bruto !== 'string' || !/^[0-9]+$/.test(bruto)) {
    return res.status(400).json(erro(400, 'Parâmetro desde inválido', [
      { campo: 'desde', problema: 'obrigatório e deve ser um inteiro maior ou igual a 0' }
    ]));
  }
  const desde = Number(bruto);

  const alteracoes = sugestoesVisiveis(req.utilizador)
    .filter((s) => s.versao > desde)
    .sort((a, b) => a.versao - b.versao);

  // cursor = maior versão devolvida, ou o próprio desde se não houver nada
  const cursor = alteracoes.length > 0 ? alteracoes[alteracoes.length - 1].versao : desde;

  return res.status(200).json({ alteracoes, cursor });
});

// Cliente (mesma origem que a API)
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

// Middleware de erros final (4 argumentos)
app.use((err, req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json(erro(400, 'Corpo do pedido com JSON mal formado'));
  }
  console.error(err); // o detalhe fica só no registo do servidor
  return res.status(500).json(erro(500, 'Erro interno do servidor'));
});

app.listen(3000, () => console.log('Servidor em http://localhost:3000'));
