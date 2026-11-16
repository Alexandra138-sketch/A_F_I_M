# Registo — sincronização offline-first

## 4.1 · Contrato e estratégia

O contrato passou de 2.1.0 para **2.2.0**, com apenas estas alterações: campo obrigatório `versao` em `Sugestao`; cabeçalho opcional `Idempotency-Key` em `POST /v2/sugestoes` (com `Idempotent-Replayed` no 201 repetido, resposta 409 nova e 400 a cobrir uma chave que não seja UUID); operação nova `GET /v2/sugestoes/alteracoes`, só com `cookieSessao`.

| Pedido | `Cache-Control` | Depende do cookie? | Quem o faz (página / SW) | Quando | Pode ser repetido sem efeitos adicionais? |
|---|---|---|---|---|---|
| `GET /v2/sessao` | `no-store` | Sim | Página | Arranque e evento `online` | Sim |
| `POST /v2/sessao` | `no-store` | Não (é ele que cria o cookie) | Página | Quando a pessoa entra | Sim: não cria recursos; só emite um cookie novo |
| `GET /v2/categorias` | `public, max-age=86400` | Não | Página (a resposta vem do SW, cache e atualização em segundo plano) | Arranque e evento `online` | Sim |
| `GET /v2/sugestoes` | `private, no-cache` | Sim | Ninguém neste cliente (a página deixou de o chamar) | — | Sim |
| `POST /v2/sugestoes` sem `Idempotency-Key` | `no-store` | Sim | Nenhum cliente desta versão (só `curl` ou clientes 2.1.0) | — | **Não**: cada repetição cria outra sugestão |
| `POST /v2/sugestoes` com `Idempotency-Key` | `no-store` | Sim | SW | Evento `sync` ou mensagem `sincronizar` | **Sim**: a mesma chave e o mesmo corpo devolvem a mesma resposta |
| `GET /v2/sugestoes/alteracoes` | `private, no-store` | Sim | SW | No pull, depois de o push ter esvaziado a fila | Sim |

### «Antes de avançar»
- **Os `fetch()` do service worker passam pelo seu próprio evento `fetch`?** Não. Esse evento só intercepta pedidos feitos por páginas controladas. Os pedidos feitos pelo SW (envio e pull) vão sempre à rede.
- **Levam o cookie?** Sim. O pedido é à mesma origem (`credentials: 'same-origin'`) e o cookie é `HttpOnly`, `SameSite=Strict`, `Path=/v2`: o browser junta-o sozinho, sem o SW o ler ou lhe ter acesso por código.
- **Alguma resposta de `/alteracoes` pode entrar na Cache API?** Não. O SW não a guarda (o evento `fetch` devolve sem `respondWith` para todo o `/v2/` que não seja `/categorias`), tem `no-store`, e a Cache API não distingue utilizadores: guardá-la entregaria as sugestões de um utilizador a outro no mesmo browser.

## 4.2 · Servidor

- **Idempotência.** As chaves ficam num `Map` indexado por `numeroAluno|chave`, com o corpo recebido, o código, o `Location` e a resposta, durante 24 h (limpeza de hora a hora). Sem chave, o comportamento é o da 2.1.0. Uma chave que não seja UUID dá 400 com `detalhes`. Chave repetida com o mesmo corpo devolve a resposta guardada com `Idempotent-Replayed: true`; com outro corpo, 409. A chave só é guardada depois de a sugestão ser criada, e um 400 de validação nunca fica guardado.
- **`versao`.** Contador global que só cresce. As sugestões do ficheiro recebem versões no arranque, por ordem de `id`; as novas recebem `++contador`.
- **`GET /v2/sugestoes/alteracoes?desde=n`.** Devolve as sugestões do utilizador com `versao > n`, por ordem crescente, e `cursor` igual à maior versão devolvida (ou a `n`). `desde` ausente, negativo ou não inteiro dá 400 com `detalhes`.
- **Ensaios** (em `.env.exemplo`, desligados por omissão): `SIMULAR_PERDA_RESPOSTA=1` e `SIMULAR_503=<n>`.

### «Antes de avançar»
- **Com `SIMULAR_PERDA_RESPOSTA=1`, o que vê o cliente na primeira tentativa?** O `fetch` é rejeitado (ligação fechada sem resposta), exatamente como numa falha de rede.
- **O que garante que a segunda tentativa não cria outra sugestão?** O servidor já tem a chave guardada com a resposta; ao receber a mesma chave com o mesmo corpo, devolve essa resposta em vez de criar.
- **E se o servidor guardasse a chave antes de criar a sugestão e falhasse entre as duas operações?** A repetição encontraria uma chave com uma resposta de uma sugestão que nunca existiu: o cliente receberia um 201 e apagaria a pendente, e a sugestão perder-se-ia sem erro nenhum. Por isso a chave só se guarda depois de criar.

## 4.3 · IndexedDB versão 2

Lojas conforme o enunciado. A migração (`onupgradeneeded`, `oldVersion < 2`) cria o índice `porUtilizador` e acrescenta `chave` (UUID novo), `tentativas = 0` e `ultimaTentativa = null` a cada pendente existente, num cursor na própria transação de upgrade, por isso sem perder nenhuma. `bd.js` usa uma ligação partilhada por contexto e trata `versionchange` fechando-a; a página mostra «Há uma versão nova da aplicação. Recarregue a página.»

`pendentes.js` foi retirado (`enviarPendentes()` deixou de existir) e deixou de ser carregado no `index.html`.

## 4.6 · Verificação

### Servidor (`curl -i`, cookie da Ana)

Pré-requisito: `npm install`, `.env` com `JWT_SEGREDO`, `node --env-file=.env servidor.js`.

```bash
curl -s -c cj.txt -H 'Content-Type: application/json' -d @pedido.json http://localhost:3000/v2/sessao
CHAVE=$(node -e "console.log(crypto.randomUUID())")
# T1 (duas vezes)
curl -i -b cj.txt -H 'Content-Type: application/json' -H "Idempotency-Key: $CHAVE" -d @pedido-sugestao.json http://localhost:3000/v2/sugestoes
curl -i -b cj.txt -H 'Content-Type: application/json' -H "Idempotency-Key: $CHAVE" -d @pedido-sugestao.json http://localhost:3000/v2/sugestoes
# T2 (mesma chave, outro titulo)
curl -i -b cj.txt -H 'Content-Type: application/json' -H "Idempotency-Key: $CHAVE" -d '{"titulo":"Outro titulo diferente","descricao":"Sugere-se a criação de mais lugares de estudo para os alunos.","categoria":"instalacoes"}' http://localhost:3000/v2/sugestoes
# T3
curl -i -b cj.txt 'http://localhost:3000/v2/sugestoes/alteracoes?desde=0'
curl -i -b cj.txt 'http://localhost:3000/v2/sugestoes/alteracoes?desde=<cursor>'
# T4
curl -i -b cj.txt 'http://localhost:3000/v2/sugestoes/alteracoes?desde=abc'
curl -i 'http://localhost:3000/v2/sugestoes/alteracoes?desde=0'
```

| # | Pedido | Esperado | Obtido (colar aqui o `curl -i`) |
|---|---|---|---|
| T1 | POST com `Idempotency-Key`, duas vezes | Dois 201 com o mesmo `Location`; o 2.º com `Idempotent-Replayed: true`; uma só sugestão | *a preencher* |
| T2 | Mesma chave, outro `titulo` | 409 com mensagem | *a preencher* |
| T3 | `alteracoes?desde=0` e depois `?desde=<cursor>` | 200 com todas as da Ana; depois 200 com lista vazia e o mesmo cursor | *a preencher* |
| T4 | `desde=abc`; e sem cookie | 400 com `detalhes`; 401 | *a preencher* |

### Browser

Cada cenário: **o que observei** e a captura onde o enunciado a pede.

| Cenário | Observado |
|---|---|
| (a) Migração no Chrome (captura) | *a preencher* |
| (b) Offline no Chrome + Background sync (captura) | *a preencher* |
| (c) Rede do SO desligada, separador fechado | *a preencher* |
| (d) Firefox, plano B | *a preencher* |
| (e) `SIMULAR_PERDA_RESPOSTA=1` | *a preencher* |
| (f) Firefox, `SIMULAR_503=3`: instantes das tentativas e comparação com o backoff (1.ª falha: `2^1`=2 s × [0,7–1,3]; 2.ª: 4 s × …; 3.ª: 8 s × …) | *a preencher* |
| (g) Válida / curta / válida: a do meio fica com «Erro» | *a preencher* |
| (h) `JWT_VALIDADE=30`: nenhum POST do SW, pendente mantida, enviada após nova entrada | *a preencher* |
| (i) Chrome + Firefox, cursor em `meta` avança (captura) | *a preencher* |
| (j) Dois separadores na versão API04; `interface-v2` apagada | *a preencher* |

### Gatilhos

Preenchimento pelo código; **confirmar cada célula com o que observar nos cenários**.

| Gatilho | Chrome | Firefox | Quem executa | Que pendentes são enviadas |
|---|---|---|---|---|
| Pendente criada com ligação | `sync.register` e o evento `sync` dispara quase de imediato | Mensagem `sincronizar` ao SW | SW | As do proprietário, sem erro |
| Pendente criada sem ligação | O registo fica à espera; o `sync` dispara quando a rede voltar | A mensagem falha com `sem-rede`; a página agenda o plano B | SW | As do proprietário |
| Entrada em `com-sessao` | `pedirSync()` depois de `guardarProprietario` | Idem, por mensagem | SW | As do proprietário |
| Evento `online` | `pedirSync()` | `pedirSync()` | SW | As do proprietário |
| Separador volta a ficar visível | `pedirSync()` | `pedirSync()` | SW | As do proprietário |
| Rede volta com o separador fechado | O browser acorda o SW com `sync` | Nada acontece (sem Background Sync) até a página voltar | SW (só Chrome) | As do proprietário |
| 503 do servidor | `sync` rejeitado; o **browser** repete com intervalos crescentes | A página agenda o plano B com backoff e jitter | SW / página | Nenhuma sai; todas ficam |
| 401 com o separador fechado | `sync` resolve (não rejeita); não se repete sozinho | — | SW | Nenhuma; ficam até haver nova entrada |

### «Antes de avançar» (4.4 e 4.5)
- **Sessão expirada, `sync` resolvido: quando volta a disparar?** Não volta sozinho: a promessa resolveu, por isso o browser considera o trabalho feito. Quem tem de o pedir de novo é a página, quando a pessoa entrar outra vez (`entrarEmComSessao` chama `pedirSync()`).
- **O Bruno entra no mesmo browser com pendentes da Ana.** O SW só envia as de `proprietario.utilizador`. Ao entrar, a página compara o utilizador com o `proprietario` e, se for outro, faz `limparBD()`, apagando as da Ana. Como o SW não lê o cookie, o que o impede de enviar as da Ana com o cookie do Bruno é o `proprietario` em `meta`, não o cookie; por isso é essencial que seja atualizado e limpo corretamente.

## 4.7 · Reflexão

1. **Edições em conflito.** *A preencher com as tuas palavras, a partir do que observaste.* Pontos a cobrir: o push cego (último a chegar ganha) perde a edição do primeiro dispositivo a sincronizar; a deteção exigiria uma precondição, por exemplo `If-Match` com a `versao` lida (resposta 412 se a versão mudou); estratégias: último a escrever ganha, fusão campo a campo, pedir à pessoa que decida.
2. **Sessão expirada com o separador fechado.** O SW não tem a palavra-passe nem acesso ao cookie `HttpOnly`; só a pessoa pode renovar a sessão. A alternativa seria guardar a palavra-passe ou um *refresh token* no dispositivo, com o risco de uma credencial duradoura ficar legível a qualquer script da origem (XSS) e em computadores partilhados.
3. **Safari e os 7 dias.** As pendentes podem ser apagadas sem aviso; `persist()` pode não resolver nesse caso. O cliente é uma cache: o que não pode perder-se tem de chegar ao servidor.
4. **Chaves em memória.** Se o servidor reiniciar entre a tentativa perdida e a repetição, a chave desaparece e a repetição cria uma segunda sugestão. Devem ficar em armazenamento persistente (base de dados, na mesma transação que a criação), durante pelo menos o tempo máximo em que um cliente pode repetir (as 24 h do contrato, ou mais).
5. **200 sugestões, uma por dia.** *Estimativa; ajustar com os valores medidos no separador Rede.* API04: cada sincronização envia 1 POST e repete `GET /v2/sugestoes` completo (≈ 200 itens, da ordem das dezenas de KB). API05: 1 POST e 1 `GET /alteracoes` com um só item (≈ 0,5 KB). O custo deixa de crescer com o histórico.
