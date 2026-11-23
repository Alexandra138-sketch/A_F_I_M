Diagnóstico inicial

a- A Ana e o Bruno comunicam, sem rede e com dez minutos de diferença, o mesmo buraco. A Ana sincroniza primeiro. O que deve acontecer quando o Bruno sincronizar? E se for a Ana a comunicá-lo duas vezes?

Resposta: Quando a Ana chegar primeiro num local com internet, a aplicação envia a comunicação dela para o servidor que registra o buraco, e quando o bruno tiver a internet de volta também, a comunicação também é enviada, mas o sistema percebe que já foi comunicado pela Ana, e por isso ao invés de criar uma nova comunicação, ele junta o dos dois, ou seja ele percebe que duas pessoas estão a falar do mesmo problema, e se Ana falar duas vez sobre o buraco, ele também percebe que é a pessoa repetindo a informação e não conta isso como duas pessoas diferentes.

b- O GPS do telemóvel indica uma precisão de 60 m e o raio da categoria buraco é 15 m. O que pode correr mal na deteção de duplicados, nos dois sentidos? Como deve a interface reagir?

Resposta: Como o gps pode não saber o local exato de onde está, pode dizer um lugar e na realidade estarmos a metros de distância, se duas pessoas relatarem o mesmo buraco, mas o gps pode pensar que são locais diferentes, o sistema diz que são buracos diferentes, ou pode ser o contrário também, ser dois buracos diferentes e o gps indicar que é apenas um. Por isso a aplicação tem que dizer que as informações não são muito precisas.

c- O Rui comunica um semáforo sem rede. Quando a comunicação chega ao servidor, é fundida na ocorrência 87. O que tem o dispositivo do Rui de fazer ao registo local, que nunca teve um id do servidor?

Resposta: Quando o Rui voltar a ter internet a informação guardada por ele é verificada pelo servidor, que vai verificar se já existe alguma informação sobre aquilo, se tiver ao invés de criar uma nova comunicação vai juntar a informação do Rui com a que já tinha, e a aplicação do rui vai ser atualizada informando que foi associada a comunicação anterior que já existia.

d- Porque não basta o cliente perguntar GET /v1/ocorrencias/semelhantes antes de criar? Dê dois exemplos em que essa verificação não evita o duplicado.

Resposta: a consulta não garante que existem que possa acontecer duplicações, porque o servidor pode mudar depois da consulta. Por exemplo, duas pessoas perguntão a aplicação se já existe algo, o servidor diz que não, se um enviar primeiro o pedido e o outro logo em seguida, se o servidor não verificar novamente pode criar dois pedidos iguais. Outro exemplo é se uma pessoa comunica uma coisa sem ter internet, e outra pessoa comunica a mesma coisa, fica registrado porque ela tem internet, mas tarde quando a pessoa sem internet voltar a ter, se o servidor não verifiacr se tem já um pedido, pode se criar dois pedidos iguais.


4.1-Contrato e estratégia

| Pedido | Cache-Control | Quem o faz (página / SW) | Funciona sem rede? | Pode ser repetido sem efeitos adicionais? |
|---|---|---|---|---|
| GET /v1/categorias | `public, max-age=86400` | Página; o SW responde com a Cache API (stale-while-revalidate) | Sim, depois da primeira visita, a partir da cache | Sim: é um GET, só lê |
| GET /v1/ocorrencias/semelhantes | `no-store` | Página (é a única consulta direta ao servidor) | Não: sem rede a página salta este passo, grava a pendente e é o servidor que decide quando ela chegar | Sim: só lê, mas o resultado pode mudar entre dois pedidos |
| GET /v1/ocorrencias?bbox= | `no-store` | Página (mapa) | Não: o mapa não carrega; a lista local lê-se da loja `ocorrencias` em IndexedDB | Sim: só lê |
| POST /v1/ocorrencias sem Idempotency-Key | `no-store` | SW, a partir da fila `pendentes` | Não: a comunicação fica em IndexedDB como «Por enviar» e sai quando houver rede | Não: se a resposta se perder e o pedido se repetir, pode dar `ja-comunicada` por acaso, mas não há garantia (por exemplo, se a ocorrência for resolvida entretanto, a repetição cria outra) |
| POST /v1/ocorrencias com Idempotency-Key | `no-store` | SW, a partir da fila `pendentes` | Não: fica na fila até haver rede | Sim: mesma chave e mesmo corpo devolvem a resposta guardada (24 h, por cidadão) com `Idempotent-Replayed: true`; mesma chave com outro corpo dá 409 |
| POST /v1/ocorrencias/{id}/reforcos com Idempotency-Key | `no-store` | SW, a partir da fila `pendentes` | Não: fica na fila até haver rede | Sim: igual ao anterior; a repetição devolve a resposta de então |
| GET /v1/ocorrencias/alteracoes | `no-store` | SW (o pull, depois do push) | Não: espera pela rede | Sim: só lê; o cursor só avança na transação que aplica as alterações |