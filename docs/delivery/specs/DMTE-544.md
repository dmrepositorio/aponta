# Cofre de Senha: ações da linha acessíveis e revelar por campo

Identidade: DMTE-544, issue dmrepositorio/aponta#289, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e5d1-18c0-7495-b10e-93e3647f292d`. Origem: auditoria DMTE-523 da tela Cofre de Senha (`/vault`), itens 1 e 2, aprovada por Alfredo. Ordem das três entregas do Cofre: DMTE-544 (esta) → DMTE-545 (itens 3 e 4 da auditoria) → DMTE-546 (item 5), porque todas editam `VaultPage.tsx`. Início pela fila: o Alfredo liberou ("Iniciar 544") em 2026-11-17; o WIP é 1 e o único PR aberto em 2026-11-17 (#335, DMTE-551, Login) não toca os arquivos do Cofre.

## Situação atual (código observado, base `ca109a3`)

`apps/web/src/pages/VaultPage.tsx`, linhas citadas na base:

- **Botões só com `title`**: copiar usuário/senha/URL (`:407-414`, `:423-430`, `:439-445`), abrir URL (`:446`), editar/excluir da linha (`:457-470`) e editar/remover pasta (`:355-368`) são `<button title=…>` ou `<a title=…>` sem `aria-label`. `title` não é nome acessível confiável em leitor de tela nem aparece em toque.
- **Sem foco visível**: nenhum deles tem classe de foco; o foco fica no contorno padrão do navegador, sem o anel do DS. O DS já tem o token `ez-focus` (DMTE-532).
- **Alvos pequenos**: copiar é um `<button>` sem padding com ícone `h-3.5 w-3.5` (**14 px**); editar/excluir têm `p-1` + ícone `h-4 w-4` (**24 px**); `EzButton` é 28/32/42 px (controles vizinhos, como o "Ações", têm 42 px).
- **Sem retorno**: `handleCopy` (`:225-228`) não confirma o sucesso e deixa a falha de `revealMutation.mutateAsync` ou de `navigator.clipboard.writeText` virar promise rejeitada sem aviso. O copiar de URL (`:441`) também.
- **Revelar**: o cadeado fica na coluna **Nome** (`:393-399`), revela usuário **e** senha de uma vez (`handleToggleReveal`, `:230-249`, duas chamadas `intent: 'reveal'` em paralelo) e o ícone (`Lock`/`LockOpen`) não diz se é estado ou ação. Falha de reveal é promise rejeitada sem aviso.
- **Ocultação**: `setRevealed({})` só roda ao trocar de pasta (`:222`). Não há timer e a busca (`:331-334`) e a paginação (`:483`) não limpam os valores revelados.
- Backend (`POST /vault/credentials/:id/reveal`, `{ field, intent }`, auditado em cada chamada) já existe e **não muda**.
- DS: `EzButton` (`variant="tertiary"`, `size="small"`, só ícone) dá 32×32 px, `ez-focus` e aceita `aria-label`/`title`; `EzAlert` (`role="alert"`) dá retorno inline. `EzToast` é só apresentação, sem provedor no app; não há outra tela com toast.

## Conflitos com as demais entregas (conferidos nas fontes)

- `git log origin/main -- VaultPage.tsx VaultPage.test.tsx useVault.ts`: o histórico local é raso (o commit `35b982f`, #322, aparece como o que introduz os arquivos); `gh pr list --state open` em 2026-11-17 traz só o #335 (DMTE-551, Login), sem arquivo do Cofre.
- Nenhum arquivo de `components/ds/` muda (restrição do card): foco e alvo vêm do `EzButton` existente; nenhuma história nova.
- DMTE-545 e DMTE-546 editam o mesmo arquivo e vêm depois; esta entrega não antecipa seus itens (coluna de ações, estados, modais, árvore).

## Decisões (propostas do planejamento dentro do pedido aprovado)

1. **Botões de ícone com `EzButton`** (`variant="tertiary"`, `size="small"`, `leftIcon`, sem `label`), com `aria-label` = ação + nome da credencial (ex.: `Copiar senha de Servidor FTP`) e `title` curto (ex.: `Copiar senha`). 32×32 px (≥ mínimo de 32 do card) e `ez-focus` vêm do DS sem alterá-lo. Excluir/remover mantêm a cor de perigo por `className`. O link "Abrir URL" (`<a>`) ganha as mesmas medidas e `ez-focus` por classes locais, com `aria-label` "Abrir URL de …" e `rel="noreferrer"`.
2. **Retorno inline, não toast.** Uma faixa acima da tabela, dentro do cartão: região `role="status"` `aria-live="polite"` sempre montada, com "Senha copiada" / "Usuário copiado" / "URL copiada" (some em ~4 s); erro em `EzAlert variant="error"` (`role="alert"`, com `onClose`), que fica até dispensado ou até a próxima ação. Motivo: o DS não tem provedor de toast e o card veda mudar o DS.
3. **Revelar por campo.** O cadeado da coluna Nome sai. Células Usuário e Senha ganham um botão de olho (`Eye`/`EyeOff`) só quando o campo existe (`hasUsername`/`hasPassword`), com `aria-pressed` e rótulo constante (`Revelar usuário de …`, `Revelar senha de …`), 32×32 px. Cada clique faz **uma** chamada `intent: 'reveal'` do campo (antes eram duas por linha), então o registro de auditoria passa a refletir o campo realmente exibido.
4. **Ocultação automática.** Cada campo revelado volta a ficar mascarado após **30 s** (constante `REVEAL_TTL_MS`, contada por campo desde que foi revelado). Também oculta todos: buscar, paginar, trocar de pasta, salvar ou excluir credencial (evita mostrar valor antigo). Resposta de reveal em voo que chega depois dessa limpeza é descartada (contador de geração). Timers são cancelados ao ocultar à mão e ao desmontar a tela.
5. **Estado do valor** vira `Record<"<id>:<campo>", string>` e uma `Set` de campos em voo (botão desabilitado e `aria-busy` durante a chamada, sem chamada duplicada). Falha de reveal/cópia mostra o erro (decisão 2), não revela e não deixa promise rejeitada.
6. **Cópia**: sucesso só depois de `writeText` resolver; clipboard indisponível (`navigator.clipboard` ausente, contexto inseguro) ou rejeitado conta como falha.
7. **Fora do escopo**: itens 3, 4 e 5 da auditoria (DMTE-545/546); limpar a área de transferência depois da cópia (risco registrado); mudanças no backend, no schema, na auditoria ou em RBAC; mudanças em `components/ds/`; modais, árvore, paginação e a coluna Ações além do necessário para o item 1.

Não aplicável: grill-with-docs → to-spec → to-tickets completos. Melhoria de acessibilidade e de segurança de exibição aprovada item a item pelo Alfredo, com proposta já escrita no card, na forma da DMTE-525/530/531/532 (uma SPEC, uma issue GitHub, um PR, sem sub-issues). Sem decisão humana pendente; as decisões acima ficam abertas ao aceite visual do Alfredo.

## Acceptance criteria

- AC-01: cada botão de ícone da linha (copiar usuário, copiar senha, copiar URL, editar, excluir) e do cabeçalho da pasta (editar, remover) tem nome acessível `aria-label` com a ação e o nome da credencial/pasta, e o link "Abrir URL" também; nenhum depende só de `title`.
- AC-02: esses controles são `EzButton` tertiary small de ícone (32×32 px, `ez-focus`) e o link "Abrir URL" usa as mesmas medidas e `ez-focus`; nenhum arquivo de `components/ds/` muda.
- AC-03: copiar usuário, senha ou URL com sucesso mostra "Usuário copiado", "Senha copiada" ou "URL copiada" numa região `role="status"` com `aria-live="polite"`, que some sozinha (~4 s); o valor copiado nunca é renderizado.
- AC-04: se o reveal (`intent: 'copy'`) falhar ou `navigator.clipboard.writeText` rejeitar ou não existir, aparece um `EzAlert` de erro visível ("Não foi possível copiar a senha."/"o usuário"/"a URL"), sem promise rejeitada não tratada.
- AC-05: a coluna Nome não tem mais o cadeado; Usuário e Senha têm botão de olho (só quando o campo existe) com `aria-pressed` `false`/`true`, rótulo `Revelar usuário de …`/`Revelar senha de …`; clicar revela somente aquele campo, com uma chamada `intent: 'reveal'` e `field` correspondente, e o outro continua mascarado; clicar de novo oculta sem nova chamada.
- AC-06: se o reveal falhar, aparece o erro visível, o campo continua mascarado, `aria-pressed` continua `false` e não há promise rejeitada; enquanto a chamada está em voo o botão do campo fica desabilitado (sem chamada duplicada).
- AC-07: 30 s depois de revelado, cada campo volta a mascarado e `aria-pressed` a `false`, contados por campo; ocultar à mão cancela o timer (não oculta de novo um campo revelado depois) e nenhum timer sobrevive ao desmontar a tela.
- AC-08: buscar, paginar, trocar de pasta, salvar ou excluir credencial oculta todos os campos revelados; um reveal em voo que responde depois dessa limpeza não mostra o valor.
- AC-09: em Chromium a 1440 e 390 px, na tela de Cofre com dados sintéticos: cada botão de ícone da linha mede ≥ 32×32 px (rect medido), o foco por teclado tem contorno de 2 px em `rgb(0, 133, 97)`, a confirmação "Senha copiada" fica visível, o olho de Senha revela só a senha, e todos os botões de ação ficam alcançáveis (dentro da área visível do cartão ou com o cartão rolando na horizontal) sem a página ganhar rolagem horizontal; a altura da linha não passa da medida na base.
- AC-10: contrato de entrega: manifest `.delivery/deliveries/DMTE-544.json` válido (`check` passa), avaliação de DS registrada como "sem alteração em `components/ds/`; reutiliza `EzButton` e `EzAlert`", RED/GREEN do coletor para AC-01 a AC-08.

## Testes (seams: a página `VaultPage`, nível do projeto: vitest + Testing Library, `api` mockado como hoje; layout e foco medidos no navegador)

- AC-01 a AC-08: `apps/web/src/pages/VaultPage.test.tsx`. Os três testes que usam o cadeado (`Revelar linha`/`Ocultar`, linhas ~240, ~281 e ~537 na base) são reescritos para o olho por campo, porque o comportamento que testavam foi substituído; os demais seguem como estão. Timer com `vi.useFakeTimers` (avanço de 30 000 ms); clipboard por `Object.defineProperty(navigator.clipboard, 'writeText', …)` como nos testes atuais; falha de reveal com `api.post` rejeitando; resposta em voo com promessa controlada.
- AC-09: `scripts/vault_actions_check.mjs` (novo; Chromium com dados sintéticos e API interceptada, mesma montagem de `scripts/mesa_focus_check.mjs`; jsdom não mede layout nem resolve `outline`). A base "antes" é gravada com `--no-assert --json` para mostrar a diferença.
- AC-10: `python3 scripts/aponta_delivery.py check --manifest .delivery/deliveries/DMTE-544.json` e a suíte `web` completa antes do QA.
- Comandos: `pnpm --filter web test -- VaultPage` para o RED/GREEN (ajustar ao script real do pacote ao implementar).

## Evidência visual e aceite

Capturas antes e depois a 1440 e 390 px (linha com os três botões em foco, confirmação "Senha copiada", olho de Senha revelado), dados fictícios, mais a medição do script. Aceite visual é do Alfredo; captura não substitui a decisão humana. O relatório completo segue na DMTE-523.

## Riscos

- **Segredo em memória do navegador:** o valor revelado vive no estado React até o timer (30 s), a limpeza ou o desmonte. É a razão do item. Mitigação: AC-07/AC-08 e descarte de resposta em voo.
- **Área de transferência:** o valor copiado fica na área de transferência até o usuário copiar outra coisa; limpar automaticamente não faz parte do pedido e depende de permissão do navegador. Registrado para decisão futura do Alfredo, não implementado.
- **Mudança de auditoria:** revelar passa a gerar uma chamada auditada por campo (antes, duas por linha). É mais fiel ao que foi exibido; quem consome a trilha vê uma entrada a menos por clique quando só um campo é pedido. Sem mudança de contrato.
- **Largura da tabela a 390 px:** a célula da URL ganha dois botões de 32 px; se a base já corta o cartão (`overflow-hidden`), AC-09 exige tornar a tabela rolável dentro do cartão (`overflow-x-auto` no `VaultPage.tsx`), sem tocar no DS. A medição "antes" do script define se isso é necessário.
- **Testes existentes por `title`:** os `getByTitle` seguem válidos (o `title` curto permanece); apenas os testes do cadeado mudam.
- Sem impacto em tenant ou RBAC: o backend e a visibilidade de editar/excluir (`ADMIN`) não mudam; revelar/copiar segue disponível como antes aos mesmos papéis.
