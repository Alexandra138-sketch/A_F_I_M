// Emissão e verificação de tokens JWT.
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

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
export async function criarToken(req, res) {
  res.set('Cache-Control', 'no-store'); // todas as respostas desta rota

  const detalhes = validarCredenciais(req.body);
  if (detalhes.length > 0) {
    return res.status(400).json(erro(400, 'Corpo do pedido inválido', detalhes));
  }

  const { utilizador, palavraPasse } = req.body;
  const registo = utilizadores.find((u) => u.utilizador === utilizador);

  // Compara sempre, mesmo que o utilizador não exista (tempo constante)
  const correta = await bcrypt.compare(palavraPasse, registo ? registo.hashPalavraPasse : HASH_FIXO);

  if (!registo || !correta) {
    // Mensagem idêntica nos dois casos e sem WWW-Authenticate
    return res.status(401).json(erro(401, 'Utilizador ou palavra-passe incorretos'));
  }

  // Payload: sub, nome e papel (+ iat e exp, acrescentados pela biblioteca).
  // Nunca a palavra-passe: o payload é legível por quem tiver o token.
  const token = jwt.sign({ nome: registo.nome, papel: registo.papel }, segredo, {
    algorithm: 'HS256',
    subject: registo.utilizador,
    expiresIn: validade,
  });

  return res.status(200).json({ token, tipo: 'Bearer', expiraEm: validade });
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
  const partes = cabecalho ? /^Bearer (\S+)$/.exec(cabecalho) : null;

  if (!partes) return responder401(res, false); // ausente ou sem a forma Bearer <token>

  try {
    // algorithms: ['HS256'] impede que o token escolha o algoritmo (ex.: "none").
    // A verificação da expiração (exp) é feita por omissão.
    const dados = jwt.verify(partes[1], segredo, { algorithms: ['HS256'] });
    req.utilizador = { sub: dados.sub, nome: dados.nome, papel: dados.papel };
    return next();
  } catch {
    return responder401(res, true); // assinatura inválida, algoritmo errado ou expirado
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