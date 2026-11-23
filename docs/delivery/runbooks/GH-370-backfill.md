# GH-370: backfill de `Ticket.descriptionText`

Roteiro do usuário. Agentes não executam nada disto: é operação em produção, feita no servidor, com backup. O comando preenche `Ticket.descriptionText` (texto visível derivado da descrição) nas linhas que existiam antes da coluna. Enquanto houver linha nula, a busca da T3 usa o fallback sobre a descrição crua; depois de `restantes = 0` o fallback deixa de ser necessário.

O que o comando faz: lê em lotes por `id` (padrão 500), calcula com `htmlToSearchText` e grava cada lote numa transação curta com `UPDATE "Ticket" SET "descriptionText" = ... WHERE id = ... AND "descriptionText" IS NULL`. A guarda `IS NULL` faz uma edição concorrente (que já grava o texto) ganhar. Não altera `description` nem `updatedAt`. É idempotente e retomável: reexecutar recomeça pelos nulos restantes.

## Antes de começar

1. O deploy da T1 (coluna) está em produção: `GET /api/version` devolve o commit da T1 ou um posterior, e o comando de pré-checagem abaixo mostra a coluna.
2. O artefato está na imagem no ar. Ele só existe em imagens construídas a partir do commit da T2 ou posterior: `docker compose ... run --rm --no-deps api ls backfill-ticket-description-text.js` (veja o prefixo do comando abaixo). Se não existir, o deploy da T2 ainda não rodou.
3. Backup recente: `scripts/backup.sh` (dump em `/home/hermes/backups/aponta`, container `aponta-prod-postgres-1`). Confirme que o arquivo novo existe e tem tamanho plausível.
4. Fora do horário de pico.

## Prefixo do comando

O comando roda na imagem de produção (`aponta-api:<sha>`), no diretório de trabalho `/app`, onde o deploy coloca `backfill-ticket-description-text.js` ao lado de `main.js`. A mesma pilha do deploy (`scripts/aponta_release.py`) usa projeto `aponta-prod`, os arquivos de ambiente do checkout do servidor e `APONTA_TAG` igual ao commit no ar. Defina uma vez:

```bash
SHA=<commit no ar, de /api/version>
CFG=/home/hermes/repos/aponta   # onde estão .env e .env.prod
BF() {
  ( cd ~/deploy/aponta/releases/$SHA &&
    APONTA_TAG=$SHA APONTA_COMMIT=$SHA APONTA_ENV_FILE=$CFG/.env \
    docker compose -p aponta-prod --env-file $CFG/.env.prod -f docker-compose.yml \
      run --rm --no-deps api node backfill-ticket-description-text.js "$@" )
}
```

`--no-deps` não sobe nem derruba nada: o `postgres` do projeto já está no ar e o container descartável só roda o comando (a `DATABASE_URL` vem do compose). O comando não imprime a `DATABASE_URL`.

## Pré-checagem (conta, não escreve)

```bash
docker exec aponta-prod-postgres-1 psql -U postgres aponta -c \
  "SELECT count(*) AS total, count(*) FILTER (WHERE \"descriptionText\" IS NULL) AS nulos FROM \"Ticket\""
```

Guarde `total` e `nulos`. A coluna precisa existir; se o `psql` acusar coluna inexistente, a T1 não está no ar.

## 1. Ensaio

```bash
BF --dry-run
```

Imprime `total`, `pendentes`, e termina com `restantes = <pendentes>`; não escreve nada. Confira que `pendentes` bate com `nulos` da pré-checagem.

## 2. Execução

```bash
BF --batch-size 500
```

Sai com código 0 e a última linha `... restantes = 0`. Cada lote imprime uma linha com lidas, processados acumulados e ignoradas por edição concorrente. Código de saída 2 significa que sobraram pendentes (reexecute); código 1, erro (argumento, `DATABASE_URL` ausente ou banco indisponível; a mensagem diz qual). Para testar com poucas linhas antes: `BF --limit 20`.

Em tabela grande use lotes menores (`--batch-size 100`) e rode fora do pico: cada lote segura locks de linha só durante a sua transação.

## 3. Conferência de nulos

```bash
docker exec aponta-prod-postgres-1 psql -U postgres aponta -c \
  "SELECT count(*) FILTER (WHERE \"descriptionText\" IS NULL) AS nulos FROM \"Ticket\""
```

Esperado: `0`. Guarde a contagem e a data: a T3 só entra depois dela. Tickets criados ou editados depois do deploy da T1 já nascem preenchidos; um nulo novo seria sinal de gravador fora do helper e deve ser investigado, não mascarado.

## Se interromper

Basta reexecutar o mesmo comando: só os nulos restantes são lidos, e o que já foi gravado não muda (`BF` de novo imprime `processados` só do que faltava). Lote em andamento na interrupção é desfeito pela transação.

## `--all`: depois de rollback de código

Rollback de código volta só o código; edições feitas pelo código antigo gravam `description` sem atualizar `descriptionText`, que fica defasado. Depois de um novo deploy:

```bash
BF --all --dry-run   # confere o volume
BF --all             # recalcula todas as linhas
```

`--all` também serve depois de qualquer mudança em `hasHtmlMarkup` ou em `htmlToSearchText` (por exemplo, a #379). Aqui a guarda é `description` igual à lida: uma edição feita entre a leitura e a escrita não é sobrescrita (aparece em "ignoradas"); reexecute se houver ignoradas.

## Se algo sair do esperado

- Contagem de `pendentes` diferente de `nulos`: pare e investigue antes de escrever (outra escrita em andamento ou banco errado).
- Erro de conexão ou `Connection terminated`: o comando usa uma conexão só; reexecute. Persistindo, verifique a saúde do `postgres` e os arquivos de ambiente.
- Desfazer dado só por backup (`scripts/backup.sh`), decisão do usuário. Como a coluna é derivada, zerar e refazer é seguro: `UPDATE "Ticket" SET "descriptionText" = NULL` seguido de `BF`.
