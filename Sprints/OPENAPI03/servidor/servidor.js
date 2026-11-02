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

// O contrato fica na pasta acima de servidor/
const contrato = readFileSync(new URL('../sugestoes.openapi.yaml', import.meta.url), 'utf-8');

// Publicação do contrato
app.get('/v2/openapi.yaml', (req, res) => {
  res.type('application/yaml').send(contrato);
});

// 11. criarToken (pública)
app.post('/v2/tokens', criarToken);

// 7. iniciar sessão com cookie
app.post('/v2/sessao', criarSessao);

app.delete('/v2/sessao', terminarSessao);

app.post('/v2/sugestoes', exigirToken, (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (req.utilizador.papel !== 'aluno') {
    return res.status(403).json(
      erro(403, 'Apenas os alunos podem criar sugestões')
    );
  }

  const corpo = req.body;

  if (
    !corpo ||
    typeof corpo.titulo !== 'string' ||
    corpo.titulo.length < 10 ||
    corpo.titulo.length > 120 ||
    typeof corpo.descricao !== 'string' ||
    corpo.descricao.length < 20 ||
    corpo.descricao.length > 2000 ||
    !['instalacoes', 'ensino', 'servicos', 'atividades', 'outra']
      .includes(corpo.categoria)
  ) {
    return res.status(400).json(
      erro(400, 'Dados da sugestão inválidos')
    );
  }

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
    dataResolucao: null
  };

  novasSugestoes.push(novaSugestao);

  res.location(`/v2/sugestoes/${id}`);

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

// 1. listarSugestoes (protegida; aluno e serviços)
app.get('/v2/sugestoes', exigirToken, (req, res) => {
  const { papel, sub } = req.utilizador;
  const todasSugestoes = [...sugestoes, ...novasSugestoes];
  // Aluno: só as suas. Serviços: todas.
  const itens = papel === 'aluno'
  ? todasSugestoes.filter((s) => s.numeroAluno === sub)
  : todasSugestoes;

  res
    .set('Cache-Control', 'private, no-cache') // depende da identidade: nunca public
    .json({ pagina: 1, tamanhoPagina: 20, total: itens.length, itens });
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