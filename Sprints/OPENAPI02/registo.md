# Registo — OPENAPI02 (autenticação com JWT)

## Palavras-passe dos utilizadores de teste
| utilizador | palavra-passe |
|---|---|
| 12345 (Ana Silva) | palavraAna1 |
| 67890 (Bruno Costa) | palavraBruno2 |
| rita.sousa (Rita Sousa) | palavraRita3 |

## 4.1 · Contrato — «Antes de avançar»

**1. Que cliente da v1 deixa de funcionar, e porquê?**
Qualquer cliente da v1 que chame as operações sobre sugestões sem enviar `Authorization: Bearer …`: passa a receber 401. Deixa também de funcionar o cliente que envia `numeroAluno` no POST /sugestoes ou `responsavel` no POST dos acompanhamentos, porque esses dados passam a vir do token. Os clientes que só usam as estatísticas e as categorias continuam a funcionar, porque são públicas. Trata-se de uma alteração incompatível (*breaking change*), e por isso a versão é 2.0.0 e o URL base é /v2, em vez de 1.1.0 em /v1: uma versão menor promete compatibilidade com os clientes existentes, e esta não a mantém. (Relacionar com a minha resposta à última questão da reflexão da API01.)

**2. Um cliente da v1 envia `numeroAluno` no POST /sugestoes: o contrato aceita ou rejeita?**
Aceita. Em OpenAPI 3.0.3, um objeto aceita por omissão propriedades que o schema não declara, e `additionalProperties` está excluído deste trabalho. `numeroAluno` já não consta de `SugestaoNova`, mas a sua presença no corpo não torna o pedido inválido. O servidor deve ignorar esse valor e usar apenas o `sub` do token: o corpo é controlado pelo cliente e não prova identidade, e aceitá-lo permitiria a um aluno criar sugestões em nome de outro.

**3. Política de cache: que respostas dependem da identidade do requerente?**
- `private, no-cache`: 200 de `listarSugestoes`, 200 e 304 de `obterSugestao`, 200 de `listarAcompanhamentos` (o conteúdo muda consoante quem pede, pelo que uma cache partilhada podia entregá-lo a outro utilizador).
- `no-store`: o 200 de `criarToken` (contém um token), as respostas de escrita (201, 200 do PUT, 204) e todas as respostas 401 e 403.
- `public`: estatísticas e categorias, porque são idênticas para todos os requerentes.

## 4.2 · Servidor — «Antes de avançar»
`jwt.verify(token, segredo, { algorithms: ['HS256'] })`:
- `algorithms: ['HS256']` impede que seja o token a escolher o algoritmo de verificação, o que bloqueia tokens com `alg: none` (sem assinatura) e ataques de confusão de algoritmos. Sem esta opção, a escolha ficaria dependente do cabeçalho do token.
- Por omissão, a biblioteca verifica a expiração (`exp`), porque `ignoreExpiration` é falso, e rejeita tokens expirados. Não se passa `ignoreExpiration`.
- O segredo é o que permite recalcular a assinatura: um payload alterado sem o segredo não passa a verificação.
- Não se usam `issuer` nem `audience`, porque há um único servidor emissor e consumidor.

## 4.4 · Verificação

### Contrato (6 alterações deliberadas)
Ferramenta: `npx @redocly/cli lint sugestoes.openapi.yaml` (configuração recomendada).

| Alteração introduzida | Tipo de problema | Ferramenta | Mensagem obtida | O que a mensagem permitiu (ou não) concluir |
|---|---|---|---|---|
| tokenJWT no security da raiz sem securitySchemes | OpenAPI inválido | Redocly lint | `There is no tokenJWT security scheme defined.` (regra security-defined, erro) | Que a referência é inválida: um nome em `security` tem de existir em `components.securitySchemes`. |
| `type: bearer` em vez de `type: http` | OpenAPI inválido | Redocly lint | `The field scheme is not allowed here.` e `The field bearerFormat is not allowed here.` (regra struct, erro) | Que `bearer` não é um `type` válido: com um tipo errado, os campos do esquema http deixam de ser admitidos. A mensagem aponta para os campos seguintes, não para o `type`, que é a causa. |
| `- tokenJWT: [servicos]` em registarAcompanhamento | Válido para o linter (erro de conceção) | Redocly lint | Nenhuma (só os 2 avisos habituais: falta de `license` e de 4XX em listarCategorias) | Que o linter não deteta o problema: num esquema http os scopes não têm significado (só em oauth2). O papel exigido não é exprimível em `security`, e fica na `description`. |
| Retirar `security: []` de listarCategorias | Válido | Redocly lint | Nenhuma | A operação passa a herdar o `security` global e a exigir token, sem que o linter avise. Um cliente público passaria a receber 401. Só se deteta ao ler ou testar o contrato. |
| `numeroAluno` no required de SugestaoNova após a remoção da propriedade | Válido | Redocly lint | Nenhuma | Que `required` pode referir uma propriedade que não existe no schema sem erro. O contrato fica incoerente: o pedido passa a exigir um campo que não está descrito. |
| `tipo: bearer` (minúsculas) no exemplo do Token | Exemplo inválido | Redocly lint | `Example value must conform to the schema: tipo property must be equal to one of the allowed values "Bearer".` (regra no-invalid-media-type-examples, aviso) | Que o exemplo não cumpre o `enum`. É um aviso e não um erro, pelo que o documento continua «válido». |

### Servidor (curl -i)
| # | Código | Cache-Control | WWW-Authenticate | Corpo | Conforme o contrato? |
|---|---|---|---|---|---|
| T1 | 200 | no-store | — | `{"token":"eyJ…","tipo":"Bearer","expiraEm":900}` | Sim |
| T2 | 401 | no-store | — (ausente) | `{"codigo":401,"mensagem":"Utilizador ou palavra-passe incorretos"}` | Sim |
| T3 | 401 | no-store | — (ausente) | Idêntico ao de T2, byte a byte (66 bytes) | Sim |
| T4 | 400 | no-store | — | `{"codigo":400,"mensagem":"Corpo do pedido inválido","detalhes":[{"campo":"utilizador","problema":"obrigatório e do tipo texto"}]}` | Sim |
| T5 | 400 | no-store | — | `{"codigo":400,"mensagem":"Corpo do pedido com JSON mal formado"}` (JSON, e não HTML) | Sim |
| T6 | 401 | no-store | `Bearer` | `{"codigo":401,"mensagem":"Autenticação necessária"}` | Sim |
| T7 | 200 | private, no-cache | — | Lista com total 2, apenas as sugestões da Ana (ids 1 e 2) | Sim |
| T8 | 200 | private, no-cache | — | Lista com total 4, todas as sugestões | Sim |
| T9 | 401 | no-store | `Bearer error="invalid_token"` | `{"codigo":401,"mensagem":"Token inválido ou expirado"}` | Sim |
| T10 | 401 | no-store | `Bearer error="invalid_token"` | Idêntico ao de T9 | Sim |
| T11 | 401 | no-store | `Bearer error="invalid_token"` | Idêntico ao de T9 | Sim |
| T12 | 200 (confirmar) | private, no-cache | — | Lista da Ana (confirmar) | Sim |

Notas:
- T9: alterei o `papel` do payload para `servicos`, mantendo a assinatura original. Falhou o recálculo da assinatura.
- T10: token emitido com validade curta e usado após a expiração. Falhou a verificação do `exp`.
- T11: falhou a verificação do algoritmo (`algorithms: ['HS256']`), antes sequer de a assinatura ser considerada.
- T12: o token continua a ser aceite após «Terminar sessão» (confirmar). O termo de sessão apenas descarta o token no cliente. O servidor não guarda estado de sessão (token autossuficiente) e só deixa de aceitar o token no instante `exp`.

### Cliente (separador Rede)
(a) `POST /v2/tokens`: o pedido leva `Content-Type: application/json` e o corpo com `utilizador` e `palavraPasse`. A resposta é 200, com `Cache-Control: no-store` e o JSON `{token, tipo, expiraEm}` (confirmar).
(b) O `GET /v2/sugestoes` leva o cabeçalho `Authorization: Bearer eyJ…` (confirmar).
(c) Com `JWT_VALIDADE=30`, ao fim de 30 s o contador chega a zero e a sessão termina com «Sessão expirada. É necessária nova autenticação.», sem qualquer pedido novo na aba Rede, porque o cliente decide pelo `exp` do payload (confirmar).
(d) Ao recarregar a página, o token perde-se (estava numa variável do módulo), aparece de novo o formulário de entrada e é necessária nova autenticação (confirmar).
(e) `localStorage` e `sessionStorage` estão vazios (confirmar).

### Construções
| Construção | Onde foi utilizada | O que passou a ser exigido | O que continua a ser permitido |
|---|---|---|---|
| securitySchemes http/bearer | `components.securitySchemes.tokenJWT` | Que o token seja enviado em `Authorization: Bearer …` | Qualquer conteúdo de token: o OpenAPI não o valida (`bearerFormat` é só informativo) |
| security na raiz | Raiz do documento, `- tokenJWT: []` | Token em todas as operações, por omissão | Declarar `security` próprio numa operação |
| security: [] | `criarToken`, estatísticas e categorias | Nada (operação pública) | Chamar sem `Authorization` |
| readOnly em numeroAluno | Schema `Sugestao` | Que o cliente não o envie; o valor é do servidor, tirado do `sub` | Recebê-lo nas respostas |
| resposta 401 + WWW-Authenticate | `NaoAutenticado`, nas operações protegidas | Que o servidor indique o esquema (`Bearer`) e distinga token ausente de inválido | O cliente autenticar-se de novo e repetir o pedido |
| resposta 403 | `Proibido`, em criarSugestao, substituirSugestao, retirarSugestao e registarAcompanhamento | Que o papel seja o adequado | Repetir com outra identidade (não com a mesma) |
| exigirToken + jwt.verify | `autenticacao.js`, rota GET /v2/sugestoes | Token com assinatura válida, HS256 e não expirado | Qualquer utilizador autenticado aceder às rotas sem restrição de papel |
| Cache-Control: no-store em criarToken | 200 de `criarToken` | Que nenhuma cache guarde a resposta | O cliente guardar o token em memória |

## 4.5 · Reflexão crítica

1. **Efeito do termo de sessão e invalidação no servidor.** O termo de sessão só descarta o token no cliente; o servidor continuou a aceitá-lo (T12) até ao `exp`, porque não mantém registo. Para o invalidar no servidor seria preciso um registo (lista de tokens revogados ou sessões), consultado em cada pedido. Isso anularia a autossuficiência, que era a vantagem do JWT: voltaria a haver estado no servidor. A revogação está excluída deste trabalho, pelo que a solução de base não resolve o problema e a resposta fica remetida para fase posterior.

2. **15 segundos vs 15 dias.** 15 segundos reduzem a janela de abuso de um token roubado, mas obrigam a autenticar quase constantemente (má experiência), e sem renovação o utilizador seria expulso a meio de tarefas. 15 dias são cómodos, mas um token roubado serviria durante todo esse tempo, sem forma de o revogar nem de reagir a mudanças de papel. Os 15 minutos são um compromisso.

3. **Variável do módulo vs localStorage; cookie HttpOnly.** Uma variável do módulo não é lida por outros scripts por nome nem fica persistente; o `localStorage` é legível por qualquer JavaScript da página, pelo que um XSS pode roubar o token. Perde-se com o recarregamento, em troca. Um cookie HttpOnly impede que o JavaScript leia o token, mas o browser envia-o automaticamente, o que introduz o risco de CSRF. Cookies estão excluídos desta ficha, pelo que fica para fase posterior.

4. **Papel no token vs consulta.** Alternativa: guardar só o `sub` e consultar o papel num registo a cada pedido. Papel no token: não há consulta, mas, se o papel mudar, o token antigo mantém o papel antigo até expirar (até 15 min). Consulta a cada pedido: a alteração tem efeito imediato, mas o servidor deixa de ser autossuficiente e passa a depender do registo em todos os pedidos.

5. **Estatísticas noutro serviço com HS256.** Com HS256 o mesmo segredo assina e verifica, pelo que o outro serviço teria de o conhecer, e quem o conhece também pode emitir tokens válidos. Quanto mais serviços o partilham, maior a superfície de ataque. Separar quem emite de quem apenas verifica exigiria outro tipo de assinatura, fora do âmbito desta ficha, pelo que a solução de base não o resolve.

6. **Tentativas sucessivas de palavras-passe.** O contrato OpenAPI 3.0.3 não consegue exprimir um limite de tentativas; apenas se poderia documentar em texto e declarar a resposta. O limite tem de ser imposto no servidor (ou à frente dele), por exemplo contando falhas por utilizador ou origem. O código adequado é 429 (Too Many Requests), eventualmente com `Retry-After`. Não está implementado nesta solução.

7. **Token Bearer em HTTP.** Nenhuma. A assinatura garante integridade, não confidencialidade: em HTTP o token (e a palavra-passe no login) viaja em claro e qualquer pessoa na rede o pode copiar e usá-lo até expirar, porque no esquema Bearer a posse do token basta para autenticar. Por isso o transporte tem de ser HTTPS fora de localhost.

8. **O que garantem o contrato, o servidor e os testes.** O contrato é uma descrição: documenta o compromisso (por exemplo, o 404 para sugestões de outros), mas nada o impõe, e o linter só verifica sintaxe e estrutura. Só o servidor garante a regra «apenas o autor edita», em código, e apenas nas rotas implementadas (aqui, só a listagem filtra por autor). Os testes garantem apenas os casos que cobrem: não provam a ausência de falhas noutros casos.
