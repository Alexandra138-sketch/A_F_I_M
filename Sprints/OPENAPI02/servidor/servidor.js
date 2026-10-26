// Arranque, rotas e tratamento de erros.
// Arrancar com: node --env-file=.env servidor.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { criarToken, exigirToken, erro } from './autenticacao.js';

const app = express();
app.use(express.json());

const sugestoes = JSON.parse(
  readFileSync(new URL('./dados/sugestoes.json', import.meta.url), 'utf-8')
);
// O contrato fica na pasta acima de servidor/
const contrato = readFileSync(new URL('../sugestoes.openapi.yaml', import.meta.url), 'utf-8');

// Publicação do contrato
app.get('/v2/openapi.yaml', (req, res) => {
  res.type('application/yaml').send(contrato);
});

// 11. criarToken (pública)
app.post('/v2/tokens', criarToken);

// 1. listarSugestoes (protegida; aluno e serviços)
app.get('/v2/sugestoes', exigirToken, (req, res) => {
  const { papel, sub } = req.utilizador;
  // Aluno: só as suas. Serviços: todas.
  const itens = papel === 'aluno' ? sugestoes.filter((s) => s.numeroAluno === sub) : sugestoes;

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