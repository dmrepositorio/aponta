# Cofre de Senha: modais que só fecham quando a API responde e erro de carga com nova tentativa

Identidade: DMTE-545, issue dmrepositorio/aponta#290, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e5d1-1a79-714a-9562-ac954aee3014`. Origem: auditoria DMTE-523 da tela Cofre de Senha (`/vault`), item 3, aprovada por Alfredo. Ordem das três entregas do Cofre: DMTE-544 (entregue, #342) → DMTE-545 (esta) → DMTE-546 (itens 4 e 5), porque todas editam `VaultPage.tsx`. Início: o Alfredo liberou as novas atividades em 2026-11-17 (comentário na DMTE-544); base `origin/main` `4cc713a`.

## Situação atual (código observado, base `4cc713a`)

`apps/web/src/pages/VaultPage.tsx`:

- **Modal local** (`Modal`, `:47`): único do app com esse padrão; `KnowledgePage`, `PermissionGroupsPage`, `ReleasesPage`, `TechnicalGroupsPage` e `OrganizationsPage` usam `EzModal`. O local não tem rodapé, foco preso, confirmação de descarte no Esc nem nome acessível do diálogo.
- **Fecha antes da resposta**: `handleSaveFolder` (`:340`) e `handleSaveCredential` (`:359`) chamam `mutate(...)` e `setFolderModal(null)`/`setCredentialModal(null)` na mesma linha, sem `onSuccess`/`onError` de interface. Se a API recusa (por exemplo 400/403/409/500), o digitado some, a lista fica igual e nada avisa.
- **Sem estado de envio**: o botão "Salvar" (`FolderModal`, `CredentialModal`) nunca desabilita; Enter ou clique duplo enviam duas vezes.
- **Erro de carga** (`:466-471`): troca a página inteira por `EzAlert` "Erro ao carregar o cofre de senhas." sem saída; a pessoa só recarrega o navegador.
- `useVault.ts`: as mutations (`useVaultMutations`) já devolvem a promise do axios; o erro HTTP chega com `error.response.data.message` (já lido por `apiErrorMessage` em `hooks/useUsers.ts`). Backend não muda.
- DS (nenhum arquivo muda): `EzModal` (`isOpen`, `onClose`, `title`, `footer`, `maxWidth`, `dirty`, `trapFocus`, `aria-label`), `EzAlert` (`role="alert"`, `onClose`), `EzButton` (`disabled`, `type`, `form`).

## Conflitos com as demais entregas (conferidos nas fontes)

- `gh pr list --state open` em 2026-11-17: o #344 (DMTE-560, Clientes/Mesa) está na fila de merge e não toca `VaultPage.tsx`, `VaultPage.test.tsx` nem `useVault.ts`. A DMTE-546 vem depois e edita o mesmo arquivo; esta entrega não antecipa seus itens (cabeçalho, tabela, coluna Ações).
- O WIP do projeto é 1; o #344 está só aguardando a fila (sem trabalho de código em curso) e o Alfredo pediu o início. Registrado no pai.
- Nenhum arquivo de `components/ds/` muda (restrição do card).

## Decisões (propostas do planejamento dentro do pedido aprovado)

1. **`EzModal` no lugar do `Modal` local** (que é removido): `maxWidth="md"`, `trapFocus`, `dirty` (Esc pede "Descartar alterações?" só quando há digitado), `aria-label` igual ao título, rodapé com "Cancelar" e "Salvar". "Salvar" é `type="submit"` com `form="<id do formulário>"`, porque o rodapé fica fora do `<form>`; Enter nos campos continua enviando.
2. **Fechar no sucesso.** O envio usa `mutateAsync` dentro de `try/catch`: o modal só fecha e `hideAllFields()` só roda depois de a API responder com sucesso. Antes, o modal fica aberto.
3. **Estado de envio.** Enquanto a chamada está em voo: "Salvar" desabilitado, `aria-busy` e rótulo "Salvando…"; "Cancelar" desabilitado; um segundo envio (Enter, clique duplo) é ignorado por guarda. O "X" e o Esc do `EzModal` continuam fechando (DS não muda); ver decisão 5.
4. **Erro dentro do modal, com os campos intactos.** Falha mostra `EzAlert variant="error"` no topo do corpo do modal, com a mensagem da API quando houver (`apiErrorMessage`) e, senão, "Não foi possível salvar a pasta. Tente novamente." / "Não foi possível salvar a senha. Tente novamente.". Nome, usuário, senha, URL, notas e pasta continuam como a pessoa deixou (os campos já são estado do modal, que não desmonta); "Salvar" volta a ficar disponível e a nova tentativa usa o digitado. O alerta some ao tentar de novo ou ao fechar o modal.
5. **Resposta depois de o modal fechado.** Se a pessoa fechou o modal (X, Esc, Cancelar antes do envio, que só o X e o Esc permitem) com a chamada ainda em voo: sucesso segue igual (oculta valores revelados; a lista atualiza pela invalidação existente); **erro vai para o aviso da página** (`EzAlert` já existente da DMTE-544), para não se perder em silêncio. Identifica-se o modal pela instância aberta (contador).
6. **Erro de carga com nova tentativa.** O alerta continua ocupando o lugar da lista, agora com o botão "Tentar de novo" (`EzButton` secondary) que refaz (`refetch`) só as consultas que falharam (pastas e/ou credenciais). Durante a nova tentativa, a tela mostra o spinner de carga já existente e, se falhar de novo, volta ao alerta.
7. **Fora do escopo**: falha de excluir senha/pasta (hoje também sem aviso; `window.confirm` e `mutate` sem retorno) fica registrada para decisão do Alfredo, porque o card limita o item 3 aos modais de salvar e ao estado de erro de carga; itens 4 e 5 da auditoria (DMTE-546); backend, schema, auditoria, RBAC; qualquer arquivo de `components/ds/`.

Não aplicável: grill-with-docs → to-spec → to-tickets completos. Melhoria de comportamento já escrita no card, aprovada item a item pelo Alfredo, na forma da DMTE-544 (uma SPEC, uma issue GitHub, um PR, sem sub-issues). Sem decisão humana pendente; a apresentação do erro (alerta no modal) fica aberta ao aceite visual.

## Acceptance criteria

- AC-01: os modais de pasta e de senha são `EzModal` (diálogo com nome acessível igual ao título, rodapé "Cancelar"/"Salvar", Esc com confirmação "Descartar alterações?" só quando há digitado); o `Modal` local não existe mais; nenhum arquivo de `components/ds/` muda.
- AC-02: criar ou editar pasta/senha só fecha o modal depois de a API responder com sucesso (o modal permanece aberto com a chamada pendente) e então oculta os valores revelados e a lista atualiza.
- AC-03: com o envio em voo, "Salvar" fica desabilitado com `aria-busy` e rótulo "Salvando…", "Cancelar" fica desabilitado, e Enter ou novo clique não fazem uma segunda chamada.
- AC-04: se a API recusa (pasta e senha, criar e editar), o modal continua aberto, o `EzAlert` de erro dentro do modal mostra a mensagem da API ou o texto padrão, todos os campos mantêm o digitado (inclusive a senha), "Salvar" volta a habilitar e uma nova tentativa com sucesso fecha o modal e envia o conteúdo mantido.
- AC-05: o alerta de erro do modal some ao tentar de novo e não reaparece ao abrir o modal outra vez; erro que chega depois de o modal ter sido fechado aparece no aviso de erro da página.
- AC-06: se a carga de pastas ou de credenciais falha, a página mostra "Erro ao carregar o cofre de senhas." com o botão "Tentar de novo"; clicar refaz somente as consultas que falharam e, com sucesso, mostra o cofre; com nova falha, volta ao alerta.
- AC-07: em Chromium a 1440 e 390 px, com dados sintéticos e a API recusando o salvar: o modal cabe na janela, o rodapé com "Salvar" e "Cancelar" fica visível sem rolar a página, o alerta de erro fica visível dentro do modal, o digitado continua nos campos, e o botão "Tentar de novo" do erro de carga fica visível e clicável.
- AC-08: contrato de entrega: manifest `.delivery/deliveries/DMTE-545.json` válido (`check` passa), avaliação de DS registrada como "sem alteração em `components/ds/`; reutiliza `EzModal`, `EzAlert` e `EzButton`", RED/GREEN do coletor para AC-01 a AC-06.

## Testes (seams: a página `VaultPage`, nível do projeto: vitest + Testing Library, `api` mockado como hoje; layout medido no navegador)

- AC-01 a AC-06: `apps/web/src/pages/VaultPage.test.tsx`. Os testes existentes que abrem e salvam modais seguem válidos (o botão "Salvar" e o `role="dialog"` permanecem); os que esperam o fechamento imediato passam a aguardar a resposta (`waitFor`). Promise controlada para a chamada pendente (AC-02, AC-03, AC-05); `api.post`/`api.patch` rejeitando com `{ isAxiosError: true, response: { data: { message } } }` e sem corpo (AC-04); `api.get` rejeitando e depois resolvendo para AC-06.
- AC-07: `scripts/vault_modals_check.mjs` (novo; Chromium com dados sintéticos e API interceptada, mesma montagem de `scripts/vault_actions_check.mjs`). A base "antes" é gravada com `--no-assert --json`.
- AC-08: `python3 scripts/aponta_delivery.py check --manifest .delivery/deliveries/DMTE-545.json` e a suíte `web` completa antes do QA.
- Comando do RED/GREEN: `pnpm --dir apps/web exec vitest run src/pages/VaultPage.test.tsx`.

## Parecer das skills de design (antes do código)

- Leitura do código e do DS: `EzModal` já entrega foco preso, rodapé, `dirty` e o confirmar de descarte; o padrão de erro dentro do modal já existe em `OrganizationsPage` (`EzAlert` com `onClose` no corpo). O erro fica junto de quem digita, em `role="alert"`, não num aviso distante.
- Rótulos de ação e de estado: "Salvar" → "Salvando…" (reticências de carregamento do app), erro com causa e ação ("Tente novamente"), "Tentar de novo" no estado de erro.
- No celular (390 px) o `EzModal` ocupa a tela inteira e o corpo rola, com rodapé fixo: é o motivo de o botão "Salvar" ir ao rodapé (decisão 1) e de AC-07 medir a visibilidade dele.
- Limites: o guia de interface da Vercel (`web-design-guidelines`) pede busca remota que não foi feita nesta execução, e o `impeccable context` não rodou; sem `PRODUCT.md`/`DESIGN.md` no repositório. O parecer vem da leitura do código, do DS e das telas vizinhas, não de nova captura.

## Evidência visual e aceite

Capturas antes e depois a 1440 e 390 px (modal com erro e campos mantidos; erro de carga com "Tentar de novo"), dados fictícios, mais a medição do script. Aceite visual é do Alfredo; captura não substitui a decisão humana.

## Riscos

- **Modal fechado com chamada em voo:** X e Esc ainda fecham (o DS não muda). Mitigação: decisão 5, o erro vai ao aviso da página e o sucesso é tratado igual.
- **Senha digitada fica no estado do modal** enquanto ele está aberto, como hoje; passa a ficar até o sucesso, não só até o clique. Não sai do navegador e é descartada ao fechar.
- **`form` no botão do rodapé:** depende de o `id` do formulário ser único por modal aberto (só um aberto por vez).
- **Excluir sem retorno:** ver "Fora do escopo"; risco conhecido e já existente.
- **Mensagem da API em texto livre:** a tela mostra `message` quando é string; o texto vem do backend do próprio produto, sem dados do segredo.
- Sem impacto em tenant ou RBAC: backend e visibilidade de criar/editar (`ADMIN`) não mudam.
