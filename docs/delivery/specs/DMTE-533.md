# Mesa: um só modelo de salvamento, com retorno ao usuário

Identidade: DMTE-533, issue dmrepositorio/aponta#305, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e002-aabf-71e5-9ec1-f782d886b0cb`. Origem: auditoria DMTE-520 da tela de Mesa (`/service-desks`), item 5, aprovada por Alfredo ("Aprovado vamos iniciar", 2026-11-15; ordem 1 e 2, 3, 4, 5). Última entrega da fila da Mesa: DMTE-530 (itens 1 e 2), DMTE-531 (3) e DMTE-532 (4) estão integradas. Início pela fila: a DMTE-535 foi integrada (PR #304, `faad4ee`) e não há outra entrega Aponta em implementação ou revisão.

## Situação atual (código observado, base `faad4ee`)

- `ServiceDesksPage.tsx` renderiza só a aba ativa (`activeTab === ...`). Os editores guardam o rascunho em `useState` próprio: trocar de aba desmonta o editor e a edição some, sem aviso. Foi o que a auditoria viu renderizado (desmarcar "Permitir cancelar ticket", trocar de aba, voltar: marcada).
- Quatro modelos de salvamento convivem na tela:
  1. **Rascunho + botão Salvar** (`MesaFlagEditor`, em 7 abas; `ServiceDeskEditor` "Salvar Membros"; `ServiceDeskSlaEditor` "Salvar cliente e SLA"; `BusinessHoursEditor`, com `isDirty`, Salvar e Descartar). Só flags e SLA mostram falha; ninguém mostra sucesso.
  2. **Formulário não controlado + submit** (Dados básicos e Status): `void api.patch(...).then(invalidate)`, sem `catch`, sem retorno.
  3. **Gravação no clique** (Prioridades e Seções): `void api.patch(...)` por checkbox, sem `catch`; falha de rede não aparece e o checkbox só muda quando a consulta é recarregada.
  4. **Mutação imediata por botão** (`MesaStagesEditor`: criar, editar, excluir): sem retorno de sucesso nem de falha.
- Parâmetros lista 9 flags numa grade única de 2 colunas, sem agrupar.
- O app usa `BrowserRouter` (sem `useBlocker`): só `beforeunload` cobre a saída da página.
- O DS já tem `EzToast` (visual, sem provedor nem região ao vivo) e `EzDialog` (`variant="warning"`, Escape cancela, botões "Cancelar" e "Confirmar"); nenhuma tela de Mesa usa `EzToast`.

## Decisão: salvar por aba (recomendação, dentro do pedido aprovado)

A auditoria deixa duas opções: salvar por aba (indicador de pendência e aviso ao sair) ou salvar por controle (toast de sucesso e de erro). **Escolha: salvar por aba**, pelos motivos abaixo; o card manda perguntar a Alfredo só se a escolha alterar a identidade, e ela não altera (verde Ocean, `Ez*`, tokens e layout ficam).
- Quase todas as abas já são "rascunho + Salvar" (flags, SLA, membros, expediente): o modelo vence 6 de 8 grupos sem mudar o hábito do admin. Salvar por controle trocaria o fluxo dessas abas.
- Um PATCH por aba mantém a regra atual de que flags de uma aba se gravam juntas (o payload de hoje é o rascunho inteiro).
- Para Prioridades e Seções muda o comportamento: deixam de gravar no clique e ganham Salvar. É o preço da consistência.
- Reversível: se Alfredo preferir salvar por controle, só os editores mudam; o retorno (toast) e as flags agrupadas ficam.

## Decisões de desenho

1. **Um canal de retorno: toast numa região ao vivo.** Módulo novo `components/mesaSave.tsx` com `MesaSaveProvider` (estado do toast e das pendências) e o hook `useMesaSave(dirty)`, que devolve `{ saved, failed }` e registra a pendência do editor. Sucesso: `EzToast variant="success"` "Alterações salvas." com `role="status"`; falha: `EzToast variant="error"` "Não foi possível salvar." com a descrição "Tente novamente." e `role="alert"`. Sucesso some em 5 s ou no fechar; falha fica até fechar ou até o próximo salvamento. O toast fica fixo no topo à direita (`fixed top-4 right-4`), longe do botão Salvar, e cada aviso é uma região ao vivo pelo próprio `role`. Os alertas inline dos editores (flags, SLA, expediente) saem: dois anúncios para o mesmo evento é pior que um.
2. **Pendência medida contra o último valor salvo.** Cada editor calcula `dirty` comparando o rascunho com o último valor salvo (o da consulta ao abrir; o gravado, depois de um salvamento com sucesso); desfazer a edição limpa a pendência e salvar com sucesso também. A consulta continua sendo invalidada como hoje. Editor sem rascunho aberto (SLA e Membros em modo leitura) não tem pendência.
3. **Indicador.** Com pendência na aba ativa, uma linha abaixo das abas diz "Alterações não salvas nesta aba." (texto, não só cor, com ponto `brand`), em região `aria-live="polite"`.
4. **Aviso ao sair.** A página guarda a ação pendente quando há alteração não salva e abre `EzDialog variant="warning"`, título "Descartar alterações?", mensagem "As alterações não salvas desta aba serão perdidas.". Cobre: trocar de aba, voltar à lista (cabeçalho e botão da barra), abrir outra mesa, nova mesa e duplicar. "Cancelar" e Escape mantêm tudo; "Confirmar" descarta e executa a ação. O rótulo dos botões é o do DS (`EzDialog` fixa "Cancelar"/"Confirmar"; trocar o rótulo é entrega de DS). `beforeunload` só existe enquanto há pendência.
5. **Prioridades e Seções** passam a usar o `MesaFlagEditor` (rascunho + Salvar), com `buildPayload` que monta `priorities: [{ ticketPriority, enabled }]` e `ticketSections: [{ key, enabled }]` com todos os itens (a API já aceita listas).
6. **Dados básicos e Status** viram controlados num módulo novo `components/MesaDeskForms.tsx` (`MesaBasicsForm`, `MesaStatusForm`); mesmo payload, mesmos rótulos de botão.
7. **Estágios:** cada criar, editar e excluir chama `saved`/`failed`; pendência = nome de novo estágio preenchido ou formulário de edição aberto com nome ou transições diferentes do estágio.
8. **Parâmetros agrupados** por tema com `<fieldset>` e `<legend>`: "Geral" (Interação com outras mesas, Permitir cancelar ticket, Mostrar o catálogo ao abrir, Abertura só por atendentes), "SLA" (Controle de SLA, Permitir adicionar horas ao SLA, Permitir parar e retomar o SLA) e "Revisão e avaliação" (Fluxo de revisão, Avaliação). Mesmas chaves e rótulos; o payload não muda. O agrupamento é um campo opcional `group` em cada flag do `MesaFlagEditor`; sem ele a grade continua única.
9. **Botão Salvar do `MesaFlagEditor`** mostra "Salvando…" e fica desabilitado enquanto grava; os demais editores só ficam desabilitados (os rótulos de "Salvar dados básicos", "Salvar status", "Salvar Membros" e "Salvar cliente e SLA" são fixos nos ACs e nos testes). Clicar na aba que já está ativa não faz nada.
10. **Mantido:** API e payloads, RBAC (a tela é só ADMIN), tabs e painel da DMTE-532, grade, filtros, criação e exclusão de mesa (a exclusão por `window.confirm` fica fora). Nenhum arquivo do DS muda.

## Acceptance criteria

- AC-01: com a aba Parâmetros alterada e salva com sucesso, aparece um aviso com `role="status"` e o texto "Alterações salvas."; o mesmo vale para Dados básicos, Status, Prioridades, Seções, Cliente e SLA, Membros, Estágios (criar, editar, excluir) e Expediente. O PATCH enviado é idêntico ao de hoje em Dados básicos, Status, flags, SLA, Membros, Estágios e Expediente.
- AC-02: quando a gravação falha em qualquer dessas abas, aparece um aviso com `role="alert"`, "Não foi possível salvar." e a descrição "Tente novamente."; a edição e as marcações do usuário continuam como estavam; o aviso de falha não some sozinho e o de sucesso some em 5 s; não há mais alerta inline duplicado nos editores de flags, SLA e expediente (o alerta da importação de feriados do expediente é de carga, não de gravação, e fica).
- AC-03: Prioridades e Seções gravam só ao acionar "Salvar" (marcar um item não chama a API), com `priorities: [{ ticketPriority, enabled }]` e `ticketSections: [{ key, enabled }]` com todos os itens da aba; falha mostra o aviso de AC-02 e mantém as marcações.
- AC-04: com alteração não salva na aba ativa, a linha "Alterações não salvas nesta aba." aparece abaixo das abas; ao desfazer a alteração, ao salvar com sucesso ou ao descartar, ela some; sem alteração, nunca aparece.
- AC-05: com alteração não salva, trocar de aba, voltar à lista, abrir outra mesa, "Nova Mesa" ou "Duplicar" abre `EzDialog` "Descartar alterações?"; "Cancelar" (e Escape) mantém a aba, a mesa e a edição; "Confirmar" descarta e executa a ação. Sem alteração, nenhuma dessas ações abre o diálogo.
- AC-06: `beforeunload` é registrado só enquanto há alteração não salva e removido ao salvar, descartar ou sair da tela; o evento tem `preventDefault` chamado quando há pendência.
- AC-07: na aba Parâmetros as 9 flags aparecem em 3 `fieldset` com `legend` "Geral", "SLA" e "Revisão e avaliação", com as mesmas chaves e rótulos e na ordem do tema; o payload do Salvar tem as mesmas 9 chaves.
- AC-08: Dados básicos e Status são controlados (o campo reflete o que o usuário digita ou escolhe), Salvar envia o mesmo payload de hoje e, depois de salvar com sucesso, o valor gravado deixa de ser pendência; o botão "Salvar dados básicos" e o "Salvar status" mantêm os rótulos.
- AC-09: `MesaFlagEditor` sem `group` nas flags mantém a grade única e o payload de hoje; `MesaFlagEditor`, `ServiceDeskSlaEditor`, `ServiceDeskEditor`, `MesaStagesEditor` e `BusinessHoursEditor` fora de um `MesaSaveProvider` funcionam sem erro (sem aviso).
- AC-10: em Chromium a 1440 e 390 px, na Mesa com API simulada (dados sintéticos): desmarcar uma flag de Parâmetros mostra a linha de pendência; clicar noutra aba abre o diálogo de descarte; "Cancelar" mantém a aba e a marcação; "Salvar" mostra o aviso de sucesso sem cobrir o botão Salvar nem criar rolagem horizontal; com a API respondendo 500, o aviso de falha aparece e a marcação continua; Parâmetros mostra 3 `fieldset`.
- AC-11: nenhum arquivo de `apps/web/src/components/ds/`, de `apps/api` nem de `apps/web-e2e` é alterado, `package.json` e `pnpm-lock.yaml` não mudam, e os testes da DMTE-530, DMTE-531, DMTE-532 e DMTE-541 em `ServiceDesksPage.test.tsx` passam sem edição.

## Testes

Seam: `ServiceDesksPage` renderizada com `api` simulado (vitest + Testing Library, o padrão do arquivo de testes da página) e cada editor isolado com `MesaSaveProvider`. O jsdom não calcula layout nem sobreposição: os testes cobrem estrutura, texto, `role`, payload e foco; o efeito visual se mede em Chromium (AC-10, `scripts/mesa_save_check.mjs`).

- AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08: casos novos em `apps/web/src/pages/ServiceDesksPage.test.tsx` (comportamento da tela) e `apps/web/src/components/MesaFlagEditor.test.tsx` (flags, grupos, retorno). As asserções falham por asserção no RED (na base não há aviso, linha de pendência, diálogo, `fieldset` nem botão Salvar em Prioridades), não por exceção de consulta.
- AC-09: casos em `MesaFlagEditor.test.tsx` e testes existentes dos editores passando sem o provedor.
- AC-10: `scripts/mesa_save_check.mjs`, `tdd_required: false`, porque o jsdom não mede sobreposição nem rolagem; o comportamento causador é coberto por AC-01 a AC-08.
- AC-11: `git diff` do PR e a suíte `web`.
- Testes existentes que mudam por decisão desta SPEC (a mudança é o próprio critério; listados no PR): `MesaFlagEditor.test.tsx`, `shows an error when saving flags fails` (o erro passa a vir do aviso; o teste renderiza com o provedor). Nenhum teste existente de Prioridades, Seções, Dados básicos ou Status cobre o fluxo (conferido por busca em `apps/web/src`).

## Parecer de design (modo Operate, tela de Mesa)

- **impeccable** (chamada Skill; `impeccable context` falhou com `Permission denied` no launcher, como na DMTE-535; o parecer partiu de `operate.md`, do DS, de `styles.css` e do código; não existem `PRODUCT.md` nem `DESIGN.md`): consistência vence expressão numa tela de tarefa. Todo componente tem estado de erro e de carregamento ("Salvando…"); um único vocabulário de salvar em toda a tela; o modal só entra onde há perda (descartar edição), como a skill pede ("modal como primeiro reflexo é preguiça"); cor de acento só em ação principal e estado, nunca como única pista (a pendência é texto). A identidade não muda.
- **web-design-guidelines** (regras buscadas de `vercel-labs/web-interface-guidelines` em 2026-11-17): "toasts e validação assíncrona com `aria-live="polite"`", "avisar antes de sair com alterações não salvas (`beforeunload` ou guarda do roteador)", "botão de envio habilitado até a requisição começar, com spinner/`Salvando…`", "ação destrutiva com confirmação", "mensagem de erro com o próximo passo", "foco visível". `useBlocker` não existe no `BrowserRouter` atual: a saída por link do menu lateral não é guardada (ver Riscos).
- **Aceite visual:** é de Alfredo. Medição e captura não substituem o aceite.

## Riscos

- **Saída por link do menu** (outra tela do app) não é guardada: o `BrowserRouter` não oferece `useBlocker`; só trocar de aba, voltar à lista, abrir ou criar mesa e fechar a janela (`beforeunload`) são. Fechar a lacuna pede trocar para `createBrowserRouter` (mudança de app inteiro), fora do escopo. Pendência para Alfredo decidir.
- **Prioridades e Seções deixam de gravar no clique.** Quem estava acostumado terá de clicar em Salvar; o indicador e o aviso de saída cobrem o esquecimento.
- **`EzToast` do DS** tem o botão de fechar com `sr-only` "Close" (inglês) e `focus:outline-none` com `ring-brand-200` (1,81:1, o ponto de foco antigo). Não muda aqui (sem DS); o aviso some sozinho no sucesso e a falha tem o fechar. Pendência de entrega de DS para Alfredo.
- **Toast no topo à direita** pode cobrir o canto do cabeçalho em 390 px por 5 s; medido em AC-10 contra o botão Salvar, não contra o cabeçalho.
- **Rótulos "Cancelar"/"Confirmar"** do diálogo de descarte são genéricos ("Confirmar" descarta). A mensagem diz o efeito; rótulo específico exige mudar o `EzDialog`.
- **Pendência medida contra o último valor salvo** (não contra a consulta): se outro admin mudar a mesma mesa em paralelo, o rascunho local não vê isso (já é assim hoje; o PATCH continua sendo o do rascunho inteiro).
- Sem impacto em API, banco, RBAC, tenant ou segredos: só apresentação e estado no cliente. A autorização continua no backend.

## Fora do escopo

Guarda de saída por link do menu (`createBrowserRouter`); rótulo dos botões do `EzDialog`; correção do `EzToast` (idioma, foco); `window.confirm` da exclusão de mesa, feedback de criação e exclusão de mesa e o aviso de descarte ao excluir ou recarregar a lista com edição pendente; salvar por controle; qualquer arquivo de `components/ds/`; mudança de API ou de regra de negócio; tema escuro.
