// Emissão e verificação de tokens JWT.
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { lerCookie } from './cookies.js';

// --- Configuração (vem de variáveis de ambiente, nunca do código) ---
const segredo = process.env.JWT_SEGREDO;
if (!segredo || segredo.length < 32) {
  console.error('ERRO: JWT_SEGREDO em falta ou com menos de 32 caracteres. ' +
    'Defina-o no ficheiro .env e arranque com: node --env-file=.env servidor.js');
  process.exit(1);
}
const validade = Number(process.env.JWT_VALIDADE) || 900; // segundos

const utilizadores = JSON.parse(
  readFileSync(new URL('./dados/utilizadores.json', import.meta.url), 'utf-8')
);

// Hash fixo, usado quando o utilizador não existe: assim o bcrypt.compare
// demora o mesmo tempo e o tempo de resposta não revela se o utilizador existe.
const HASH_FIXO = bcrypt.hashSync('palavra-passe-que-nunca-sera-usada', 10);

// Corpo de erro conforme o schema Erro do contrato
export function erro(codigo, mensagem, detalhes) {
  return detalhes ? { codigo, mensagem, detalhes } : { codigo, mensagem };
}

// Validação do corpo conforme o schema Credenciais
const PADRAO_UTILIZADOR = /^([0-9]{5,8}|[a-z]+\.[a-z]+)$/;

function validarCredenciais(corpo) {
  const detalhes = [];
  const c = corpo !== null && typeof corpo === 'object' ? corpo : {};

  if (typeof c.utilizador !== 'string') {
    detalhes.push({ campo: 'utilizador', problema: 'obrigatório e do tipo texto' });
  } else if (!PADRAO_UTILIZADOR.test(c.utilizador)) {
    detalhes.push({ campo: 'utilizador', problema: 'deve ser um número de aluno (5 a 8 algarismos) ou nome.apelido' });
  }

  if (typeof c.palavraPasse !== 'string') {
    detalhes.push({ campo: 'palavraPasse', problema: 'obrigatório e do tipo texto' });
  } else if (c.palavraPasse.length < 8 || c.palavraPasse.length > 128) {
    detalhes.push({ campo: 'palavraPasse', problema: 'deve ter entre 8 e 128 caracteres' });
  }
  return detalhes;
}

// --- POST /v2/tokens (criarToken) ---

async function autenticar(req, res) {
  res.set('Cache-Control', 'no-store');

  const detalhes = validarCredenciais(req.body);
  if (detalhes.length > 0) {
    res.status(400).json(erro(400, 'Corpo do pedido inválido', detalhes));
    return null;
  }

  const { utilizador, palavraPasse } = req.body;
  const registo = utilizadores.find((u) => u.utilizador === utilizador);

  const correta = await bcrypt.compare(
    palavraPasse,
    registo ? registo.hashPalavraPasse : HASH_FIXO
  );

  if (!registo || !correta) {
    res.status(401).json(erro(401, 'Utilizador ou palavra-passe incorretos'));
    return null;
  }

  const token = jwt.sign(
    { nome: registo.nome, papel: registo.papel },
    segredo,
    {
      algorithm: 'HS256',
      subject: registo.utilizador,
      expiresIn: validade,
    }
  );

  return {
    token,
    tipo: 'Bearer',
    expiraEm: validade,
    utilizador: registo.utilizador,
    nome: registo.nome,
    papel: registo.papel
  };
}


export async function criarToken(req, res) {
  const resultado = await autenticar(req, res);

  if (!resultado) return;

  return res.status(200).json({
    token: resultado.token,
    tipo: resultado.tipo,
    expiraEm: resultado.expiraEm
  });
}

export async function criarSessao(req, res) {
  const resultado = await autenticar(req, res);

  if (!resultado) return;

  res.cookie('sessao', resultado.token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/v2',
    maxAge: resultado.expiraEm * 1000
  });

  const expiracao = new Date(
    Date.now() + resultado.expiraEm * 1000
  ).toISOString();

  return res.status(200).json({
    utilizador: resultado.utilizador,
    nome: resultado.nome,
    papel: resultado.papel,
    expiracao
  });
}

// --- Middleware exigirToken ---
function responder401(res, tokenInvalido) {
  res
    .status(401)
    .set('WWW-Authenticate', tokenInvalido ? 'Bearer error="invalid_token"' : 'Bearer')
    .set('Cache-Control', 'no-store')
    .json(erro(401, tokenInvalido ? 'Token inválido ou expirado' : 'Autenticação necessária'));
}


export function exigirToken(req, res, next) {
  const cabecalho = req.get('Authorization');
  let token;

  if (cabecalho !== undefined && cabecalho !== null) {
    const partes = /^Bearer (\S+)$/.exec(cabecalho);

    if (!partes) return responder401(res, true);

    token = partes[1];
  } else {
    token = lerCookie(req, 'sessao');

    if (!token) return responder401(res, false);
  }

  try {
    const dados = jwt.verify(token, segredo, { algorithms: ['HS256'] });
    req.utilizador = {
      sub: dados.sub,
      nome: dados.nome,
      papel: dados.papel,
      exp: dados.exp
    };
    return next();
  } catch {
    return responder401(res, true);
  }
}

// --- Middleware exigirPapel ---
export function exigirPapel(papel) {
  return (req, res, next) => {
    if (req.utilizador.papel !== papel) {
      return res
        .status(403)
        .set('Cache-Control', 'no-store')
        .json(erro(403, 'Sem permissão para esta operação'));
    }
    return next();
  };
}

export function terminarSessao(req, res) {
  res.clearCookie('sessao', {
    path: '/v2'
  });

  return res.status(204).end();
}