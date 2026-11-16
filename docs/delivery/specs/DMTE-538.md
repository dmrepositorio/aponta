# Contratos: formulário em seções e checkboxes da marca

Identidade: DMTE-538, issue dmrepositorio/aponta#288, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e1dc-2654-7da4-a5aa-222c7309987f`. Origem: auditoria DMTE-521 da tela de Contratos (`/contracts`), item 3; os itens 1 e 2 foram entregues na DMTE-536. Pedido de início de Alfredo no card: "Vamos iniciar a solução agora".

## Situação atual (código observado)

`apps/web/src/components/contracts/ContractViews.tsx`, `ContractForm`, base `a403a99`:

- Um único `<fieldset disabled={pending} className="grid grid-cols-1 gap-4 sm:grid-cols-2">` guarda todos os campos, sem seções. Ordem: Nome, Empresa, Modalidade, "Contrato ativo", "Condições comerciais aprovadas", Mesas, Início, Fim, campos da modalidade, "Novas condições a partir de" (só na edição), "Data de reajuste". Com 3 campos de data o último fica sozinho na linha.
- Os quatro tipos de checkbox são `<input type="checkbox">` nativos sem classe: "Contrato ativo", "Condições comerciais aprovadas", cada mesa e a mesa não vinculada. O navegador desenha o azul padrão (`accent-color: auto`).
- O DS já tem `EzCheck` (`components/ds/EzCheck.tsx`): `<label>` que envolve o `<input type="checkbox">` real (`appearance-none`, `checked:bg-brand-600`, anel `focus-visible`), com `label`, `labelClassName` e `disabled`. Outras telas já o usam (`OrganizationsPage.tsx`, `ServiceDeskEditor.tsx`). `--color-brand-600` é `#008561` em `styles.css`.
- Quem depende dos nomes acessíveis: `CommercialContract.test.tsx` (`getByLabelText('Condições comerciais aprovadas')`) e `apps/web-e2e/src/contracts.spec.ts:53` (`getByLabel('Condições comerciais aprovadas', { exact: true }).check()`).

## Decisões (proposta do planejamento dentro do pedido aprovado)

1. **Controle do DS, sem edição no DS.** Os checkboxes passam a `EzCheck`. É a alternativa "controle do DS" do card; `accent-brand-600` deixaria o desenho nativo. Nenhum arquivo de `components/ds/` muda. O elemento continua um `<input type="checkbox">`, então o papel `checkbox`, o nome acessível, o teclado e o `.check()` do E2E não mudam.
2. **Seções por `<fieldset>` + `<legend>`**, na ordem do card: Identificação, Vigência, Condições comerciais, Mesas de serviços cobertas (a legenda atual da mesa fica). Legenda como título pequeno (`text-sm font-semibold text-gray-900`), sem moldura, seções separadas por `space-y-6`.
3. **Os dois interruptores juntos no topo**, num grupo próprio (`<fieldset>` com legenda só para leitor de tela, "Situação do contrato"), em linha (`flex flex-wrap gap-x-6 gap-y-2`) antes de Identificação. Decisão do planejamento: o card pede a posição, não um título visível; uma legenda a mais ocuparia um título para duas caixas.
4. **Distribuição dos campos:**
   - Identificação: Nome do contrato, Empresa, Modalidade.
   - Vigência: Início da vigência, Fim da vigência, Data de reajuste (as três datas juntas; decisão do planejamento: a "Data de reajuste" sai da última linha avulsa e fica com as outras datas).
   - Condições comerciais: os campos da modalidade (franquia, escopo, preço, estimativa, hora avulsa, valor mensal, hora excedente) e "Novas condições a partir de" na edição, com os avisos que já existem.
   - Mesas de serviços cobertas: como hoje, com `EzCheck`.
   - Grade das seções: `grid-cols-1 sm:grid-cols-2`; Identificação e Vigência têm 3 campos e usam `lg:grid-cols-3`, para não deixar campo sozinho em linha. A legenda de cada seção fica fora da grade.
5. **`pending` continua desabilitando tudo**: o `<fieldset disabled>` externo (sem legenda) envolve as seções; cada `EzCheck` recebe também `disabled={pending}` porque o estilo de "desabilitado" do DS lê a prop, não o `fieldset`. Os `<fieldset>` ganham `min-w-0` para não estourar a largura no celular.
6. Sem mudança no payload do `onSave`, nas validações, no texto das mensagens, na API, no schema ou no RBAC (o formulário só aparece para quem `canManage`, como hoje).

## Acceptance criteria

- AC-01: o formulário tem os grupos "Identificação", "Vigência", "Condições comerciais" e "Mesas de serviços cobertas", cada um um `<fieldset>` com `<legend>`; Nome, Empresa e Modalidade estão em Identificação; Início, Fim e "Data de reajuste" em Vigência; os campos da modalidade em Condições comerciais (e "Novas condições a partir de" na edição); as mesas em Mesas de serviços cobertas.
- AC-02: "Contrato ativo" e "Condições comerciais aprovadas" estão no mesmo grupo ("Situação do contrato"), que vem antes de Identificação na ordem do documento.
- AC-03: todo checkbox do formulário (os dois interruptores, cada mesa e a mesa não vinculada) é desenhado pelo `EzCheck` do DS (`appearance-none` e `checked:bg-brand-600`, nenhum nativo); o nome acessível de cada um continua o mesmo e marcar/desmarcar continua alterando `active`, `approved` e `serviceDeskIds` no que `onSave` recebe.
- AC-04: com `pending`, todos os campos e checkboxes do formulário ficam desabilitados, nas cinco seções.
- AC-05: o comportamento existente continua: sem mesas na empresa, aparece o texto "Selecione uma empresa com mesas explicitamente vinculadas…"; mesa não vinculada continua com "Mesa não vinculada à empresa (…) — remova para regularizar" e some ao desmarcar. Os testes existentes (`ContractForm.test.tsx`, `CommercialContract.test.tsx`) passam sem edição.
- AC-06: no navegador (Chromium, 1440 px e 390 px, dados fictícios), o formulário não tem rolagem horizontal, as seções aparecem na ordem do AC-01, nenhum campo fica sozinho em linha em 1440 px nas seções Identificação e Vigência, e um checkbox marcado tem fundo `rgb(0, 133, 97)` (token `brand-600`), não o azul do navegador.
- AC-07: nenhum arquivo de `apps/web/src/components/ds/`, de `apps/api` nem de `apps/web-e2e` é alterado, e o payload de `onSave` e as validações não mudam.

## Testes (seams: o componente `ContractForm`; vitest + Testing Library; sem mock de módulo interno)

- AC-01, AC-02, AC-03, AC-04, AC-05 (mesas): novo arquivo `apps/web/src/components/contracts/ContractFormSections.test.tsx`, que renderiza `ContractForm` e consulta por papel (`group` com nome da legenda, `checkbox`) e `within(grupo)`.
- AC-05 (regressão): `ContractForm.test.tsx` e `CommercialContract.test.tsx`, existentes, rodam sem edição.
- AC-06: medição em Chromium, resultado e capturas no PR (jsdom não calcula layout nem lê `:checked` do CSS do Tailwind; o comportamento que causa o azul, a ausência da classe do DS, é coberto pelo AC-03).
- AC-07: `git diff` do PR sem arquivo nesses diretórios.

## Evidência visual e aceite

Capturas do formulário de novo contrato e de edição, a 1440 px e 390 px, antes e depois, anexadas ao PR como evidência técnica. O aceite visual é de Alfredo; screenshot não substitui a decisão. Sem componente novo no DS, então sem story nova; `Contracts.stories.tsx` renderiza `ContractForm` e continua valendo (conferido para não depender do texto antigo).

## Riscos

- Quem usa o teclado vê o mesmo `<input type="checkbox">`; o anel de foco passa a ser o do `EzCheck` (`focus-visible:ring-brand-200`), diferente do anel nativo.
- A "Data de reajuste" muda de posição (da última linha para Vigência) e as mesas seguem após as condições: a ordem de tabulação acompanha a ordem visual nova. O E2E `contracts.spec.ts` seleciona por rótulo, não por posição.
- O `EzCheck` tem 20 px (o nativo tem 13 px): o alvo fica maior, e o rótulo inteiro é área clicável (`<label>` envolve o controle).
- Sem impacto em RBAC, tenant ou API: só apresentação. Contratos com muitas mesas quebram em várias linhas (`flex-wrap`).
