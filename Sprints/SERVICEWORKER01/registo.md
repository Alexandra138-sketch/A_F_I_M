# Registo — service worker e IndexedDB

## 4.1 · Contrato e estratégia

O contrato mantém-se na versão 2.1.0, sem alterações. Confirmei que `listarCategorias` tem `security: []` e `Cache-Control: public, max-age=86400`, e que o 201 de `criarSugestao` tem `Location` e `Cache-Control: no-store`.

| Pedido | `Cache-Control` no contrato | Depende do cookie? | Estratégia no service worker | Guardado em IndexedDB? |
| Ficheiros da interface (`/`, `/app.js`, …) | — | Não | Cache primeiro (`interface-v1`) | Não |
| `GET /v2/categorias` | `public, max-age=86400` | Não (`security: []`) | Cache e atualização em segundo plano (`dados-publicos`) | Não |
| `POST /v2/sessao` | `no-store` | Não (`security: []`; é ele que cria o cookie) | Só rede | Não |
| `GET /v2/sessao` | `no-store` | Sim | Só rede | Não (só os dados da sessão, em `meta`) |
| `DELETE /v2/sessao` | `no-store` | Não exige (`security: []`), mas é ele que apaga o cookie | Só rede (não é `GET`) | Não |
| `GET /v2/sugestoes` | `private, no-cache` | Sim | Só rede | **Sim**, loja `sugestoes` |
| `POST /v2/sugestoes` | `no-store` (no 201) | Sim | Só rede (não é `GET`) | **Sim**, loja `pendentes`, se falhar a rede |

### «Antes de avançar»
Nenhuma linha com «sim» na coluna «Depende do cookie?» tem uma estratégia diferente de «só rede»: `GET /v2/sessao`, `GET /v2/sugestoes` e `POST /v2/sugestoes`. A razão é que a Cache API identifica cada resposta apenas pelo método e pelo URL, e o cookie não faz parte dessa identificação. Uma resposta como a de `GET /v2/sugestoes` guardada ali seria entregue a quem pedisse o mesmo URL no mesmo browser, mesmo sendo de outro utilizador. O `private` do contrato não ajuda, porque a Cache API não respeita o `Cache-Control`.

## 4.2 · Servidor

- `GET /v2/categorias` é pública, devolve as cinco categorias (`codigo` e `descricao`) com `Cache-Control: public, max-age=86400`.
- `POST /v2/sugestoes` valida o corpo conforme `SugestaoNova` e devolve 400 com um elemento em `detalhes` (`campo` e `problema`) por cada campo inválido. Só lê `titulo`, `descricao` e `categoria`: um `numeroAluno` enviado no corpo é ignorado e usa-se sempre o `sub` do token. Em caso de sucesso devolve 201 com `Location: /v2/sugestoes/{id}` e `Cache-Control: no-store`.

## 4.6 · Verificação

### Servidor (curl -i)
| # | Pedido | Código | Cache-Control | Corpo / cabeçalhos relevantes | Conforme o contrato? |
| T1 | `GET /v2/categorias` sem cookie | 200 | public, max-age=86400 | Lista das cinco categorias | Sim |
| T2 | `POST /v2/sugestoes` com `titulo` de 5 caracteres | 400 | no-store | `{"codigo":400,"mensagem":"Dados da sugestão inválidos","detalhes":[{"campo":"titulo","problema":"deve ter entre 10 e 120 caracteres"}]}`  | Sim |
| T3 | `POST /v2/sugestoes` com `"numeroAluno": "99999"` | 201 | no-store | `Location: /v2/sugestoes/{id}`; sugestão com `numeroAluno` `12345`  | Sim |

Notas:
- T2: o `titulo` tinha 5 caracteres, abaixo do mínimo de 10 de `SugestaoNova`. O 400 chegou depois de o token ser aceite, por isso a validação do corpo acontece só para pedidos autenticados.
- T3: o servidor só lê `titulo`, `descricao` e `categoria`. O `numeroAluno` da sugestão criada vem do `sub` do token (Ana, `12345`), e não do corpo.

### Browser (separadores Rede e Aplicação)
(a) Em Aplicação > Service Workers, o service worker está ativo. As caches são `interface-v1` (ficheiros da interface) e `dados-publicos` (apenas `/v2/categorias`). Não há respostas de `/v2/sessao` nem de `/v2/sugestoes` em nenhuma delas .

(b) Na coluna «Tamanho» do separador Rede, os ficheiros da interface e `/v2/categorias` aparecem como servidos pelo service worker; `/v2/sessao` e `/v2/sugestoes` mostram o tamanho real, porque vão à rede.

(c) Com a rede em «3G lento», ao recarregar aparece «A verificar sessão…» até chegar a resposta de `GET /v2/sessao`, e só depois a interface passa a `sem-sessao` ou `com-sessao` .

(d) Com **Offline** ativo, ao recarregar a página abre (interface vinda da cache), o `GET /v2/sessao` falha e a interface passa a `sem-ligacao`. Mostra «Sem ligação ao servidor.» e a cópia local com «Cópia de HH:MM (Ana Silva)». O botão «Terminar sessão» fica desativado, com a explicação .

(e) Sem ligação, a sugestão criada aparece na loja `pendentes` (Aplicação > IndexedDB > `sugestoes-bd`) e na lista como «Por enviar». Ao repor a ligação, o evento `online` repete `GET /v2/sessao` e envia a pendente: `POST /v2/sugestoes` devolve 201, a pendente sai de `pendentes` e a sugestão entra em `sugestoes` .

(f) Com `JWT_VALIDADE=30`, criei uma pendente sem ligação e esperei mais de 30 s antes de repor a ligação. O `GET /v2/sessao` devolveu 401 e a interface passou a `sem-sessao`, com «A sessão expirou. Entre de novo.». A pendente ficou na IndexedDB, sem ser enviada nem apagada. Depois de entrar de novo, foi enviada .

(g) Sem ligação, ao mudar a ordenação a lista é reordenada a partir da IndexedDB, lendo o índice `porData` (decrescente, para «recentes») ou `porEstado`, sem qualquer pedido novo no separador Rede .

(h) A Ana termina sessão: `DELETE /v2/sessao` devolve 204, as três lojas da IndexedDB ficam vazias e o rascunho é apagado. O Bruno entra e vê apenas as suas sugestões, sem nada da Ana .

(i) A sessão da Ana expira sem ela terminar sessão, e a sua cópia fica na IndexedDB. Quando o Bruno entra no mesmo browser, a interface compara o utilizador com o `proprietario` guardado, vê que é diferente e apaga a cópia (`limparBD`) antes de guardar o novo proprietário.

(j) Depois de mudar o nome da cache para `interface-v2` no `sw.js`, a nova versão instala-se mas fica «à espera» (`waiting`), porque a página ainda é controlada pela versão anterior. Aparece o botão «Atualizar a aplicação». Ao clicar, a página envia `{ tipo: 'ativar' }`, o service worker chama `skipWaiting()`, o evento `controllerchange` recarrega a página e o `activate` apaga a cache `interface-v1`.

### Onde fica cada dado
| Dado | Mecanismo usado | Quem escreve | Quando é apagado | Porque não se usou outro mecanismo |
|---|---|---|---|---|
| token | cookie `HttpOnly` | servidor (`Set-Cookie` em `POST /v2/sessao`) | quando expira (`maxAge`) ou no `DELETE /v2/sessao` | o JavaScript não precisa de o ler, e `HttpOnly` impede que um script o roube; no `localStorage` qualquer script o leria |
| configurações | `localStorage` | página | não se apagam sozinhas | são preferências simples; `sessionStorage` perdê-las-ia ao fechar o separador |
| rascunho | `sessionStorage` | página | ao enviar a sugestão, ao terminar sessão ou ao fechar o separador | só deve durar enquanto o separador existe; o `localStorage` deixaria texto guardado em computadores partilhados |
| ficheiros da interface | Cache API (`interface-v1`) | service worker | quando a nova versão se ativa e apaga as caches antigas | são iguais para todos e têm de abrir sem ligação |
| categorias | Cache API (`dados-publicos`) | service worker | não são apagadas; vão sendo substituídas pela atualização em segundo plano | são públicas e não dependem do cookie |
| lista de sugestões | IndexedDB (`sugestoes`) | página | ao terminar sessão, ou quando entra outro utilizador; é substituída a cada `GET /v2/sugestoes` | é privada, e a Cache API não distingue quem fez o pedido; o `localStorage` não tem índices nem guarda objetos |
| sugestões pendentes | IndexedDB (`pendentes`) | página | quando são enviadas (201), descartadas, ou ao terminar sessão | têm de sobreviver ao fecho do browser e são objetos com estado próprio (por enviar, com erro) |

### Construções
| Construção | Onde foi utilizada | O que passou a ser exigido | O que continua a ser permitido |
|---|---|---|---|
| Cache primeiro | `sw.js`, ficheiros da interface (`interface-v1`) | Que todos os ficheiros estejam listados no `install`; se um faltar, a instalação falha | Abrir a página sem ligação |
| Cache e atualização em segundo plano | `sw.js`, `GET /v2/categorias` (`dados-publicos`) | `evento.waitUntil`, para a atualização terminar depois de a resposta sair | Responder logo com a cópia guardada |
| Pedido sem `respondWith` | `sw.js`, todo o `/v2/…` restante e todos os pedidos que não são `GET` | Que o browser os trate como se não houvesse service worker | Enviar o cookie normalmente; nenhuma resposta privada fica guardada |
| `skipWaiting` por mensagem | `sw.js` e `app.js` | Que a nova versão só se ative quando a pessoa o pede | Continuar a usar a versão antiga até lá |
| `onupgradeneeded` | `bd.js`, `abrirBD()` | Criar lojas e índices apenas ao abrir com uma versão superior | Ler e escrever dados em transações |
| Transação única | `substituirSugestoes` e `confirmarPendente` | Que apagar e preencher (ou remover a pendente e guardar a sugestão) seja tudo ou nada | As outras funções usarem transações próprias |
| Registo `proprietario` (`meta`) | `bd.js` e `app.js` (ao entrar) | Comparar o utilizador que entra com o dono da cópia local | O mesmo utilizador voltar a ver a sua cópia |

## 4.7 · Reflexão crítica

1. **Que operação de autenticação continua impossível sem ligação?** Terminar a sessão. O token está num cookie `HttpOnly`, que o JavaScript não consegue ler nem apagar: só o servidor o apaga, através do `DELETE /v2/sessao`. Por isso o botão fica desativado em `sem-ligacao`. Entrar também exige ligação, porque só o servidor valida as credenciais e emite o cookie.

2. **E se a ligação tivesse caído depois de o servidor criar a sugestão e antes de chegar a resposta, em (e)?** O `fetch` seria rejeitado e a página não saberia que a sugestão já existia. Guardá-la-ia como pendente e, no reenvio, o servidor criaria uma segunda sugestão igual, porque o `POST` não é idempotente. Resolve-se com uma chave de idempotência: o cliente gera um UUID quando cria a pendente e envia-o num cabeçalho `Idempotency-Key`; o servidor guarda a resposta de cada chave e devolve a mesma se o pedido se repetir. No contrato é uma alteração aditiva (um cabeçalho opcional), pelo que a versão passaria de 2.1.0 para 2.2.0.

3. **O que resolveria a Background Sync API, e porque é que o cookie continuaria a ser uma limitação?** Permitiria ao service worker enviar as pendentes quando a ligação volta, mesmo com a página fechada; hoje só se enviam com a página aberta (no evento `online` ou ao entrar). Mas o envio continua a precisar do cookie de sessão, que expira ao fim de poucos minutos. Se expirou, o service worker receberia 401 e não poderia obter outro: só a pessoa, com a palavra-passe, o consegue, e a aplicação não a guarda. Esta API está excluída desta ficha, pelo que fica para fase posterior.

4. **Que risco tem a cópia local da Ana num computador partilhado, e o que o reduz?** Depois de a sessão expirar, os títulos e as descrições da Ana continuam na IndexedDB, legíveis nas ferramentas de programador, até outra pessoa entrar ou a Ana terminar sessão com ligação. Reduzem o risco estas regras: a cópia só é mostrada se a sessão do proprietário ainda não expirou; é apagada ao terminar sessão e quando entra outro utilizador; as pendentes só são enviadas pelo utilizador a quem pertencem; e nada privado vai para a Cache API. Fica por resolver o facto de os dados estarem guardados em claro, sem cifra, e de continuarem lá se a pessoa fechar o browser sem terminar sessão.

5. **Se a Ana mudar de computador, leva as configurações? E as pendentes?** Não leva nenhuma das duas, porque ficam no browser do primeiro computador (`localStorage` e IndexedDB). As configurações já eram assim na API03. A novidade são as pendentes: ficam presas nesse computador e só são enviadas quando a Ana lá voltar e entrar. A lista de sugestões obtém-na do servidor ao entrar no segundo computador. (Relacionar com a minha resposta da API03.)