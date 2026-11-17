# Contratos: erro de validação do formulário visível

Identidade: DMTE-539, issue dmrepositorio/aponta#300, Tier 2, ciclo 2026-11-09/2026-11-22, pai Multica `01a1e1dc-2688-7527-91d1-b2dac726d3e1`. Origem: auditoria DMTE-521 da tela de Contratos (`/contracts`), item 4, aprovada por Alfredo ("Pode", depois do aviso de que há tickets de auditoria que alteram o DS grid).

## Situação atual (código observado e renderizado)

Renderizado em Chromium (Vite local, API simulada com 5 contratos fictícios, perfil ADMIN, base `374023f`), com medições de DOM:

- `ContractViews.tsx` (`ContractForm`): o alerta de erro (`EzAlert variant="error"`, `role="alert"`) é o primeiro filho do formulário e o botão "Salvar contrato" é o último. A 390 px o formulário tem cerca de 1.500 px; depois de clicar em Salvar com a empresa em branco, o alerta fica a -587 px da área visível (`scrollY` 909) e o foco continua em "Salvar contrato". A 1440 px o alerta fica à vista (topo a 192 px) mas o foco também continua no botão.
- A mesma coisa vale para o erro devolvido pela API ao gravar (`error` do `ContractsPage`, que usa `save.error`).
- **Toolbar em tela estreita (outra metade do item 4): já entregue.** O PR #283 (DMTE-531) alterou `EzEntityToolbar`. Medido a 390 px na base `374023f`: a barra tem uma faixa de botões (59 px), o contador "1 de 5" fica em linha própria e não é cortado (termina em x=353 de 390). Nada a fazer nesta entrega e nenhum arquivo de DS muda.

## Decisões (proposta do planejamento dentro do pedido aprovado)

1. **Sem edição no DS.** Nenhum arquivo de `apps/web/src/components/ds/` muda. A correção fica em `ContractForm`.
2. **Foco e rolagem no alerta**: o alerta ganha um contêiner focável por programa (`tabIndex={-1}`, sem anel) e, a cada tentativa que falha, o formulário rola o contêiner para o centro da área visível (`scrollIntoView({ block: 'center' })`) e foca nele (`focus({ preventScroll: true })`). O leitor de tela lê o alerta (`role="alert"` já existe). A mensagem não muda.
3. **Cada tentativa conta**: a validação usa um contador (`failed`) incrementado a cada falha, para que apertar Salvar duas vezes com o mesmo erro mova o foco de novo. O erro da API move o foco quando aparece (`error` passa de vazio para texto a cada nova tentativa, porque a mutação limpa o erro enquanto grava).
4. **Fora desta entrega**: marcar o campo com `aria-invalid` e mensagem por campo (o texto do alerta já nomeia o problema; a marcação por campo pede mudar a validação de uma mensagem para várias e fica como proposta).
5. Sem API, schema ou regra de negócio; mensagens de validação idênticas.

## Acceptance criteria

- AC-01: quando a validação do formulário falha, o contêiner do alerta recebe o foco e `scrollIntoView` é chamado com `block: 'center'`; o alerta mantém `role="alert"` e a mesma mensagem.
- AC-02: quando a gravação falha com erro da API, o alerta com a mensagem do servidor recebe o foco e é rolado até a vista da mesma forma.
- AC-03: cada tentativa que falha move o foco de novo, inclusive com a mesma mensagem da tentativa anterior (Salvar duas vezes sem corrigir).
- AC-04: a 390 px, no navegador, depois de clicar em Salvar com erro, o alerta fica dentro da área visível e com o foco (medido em Chromium com a massa da auditoria; antes: alerta a -587 px, foco no botão).
- AC-05: nenhum arquivo de `apps/web/src/components/ds/` nem de `apps/api` é alterado; as mensagens de validação existentes ficam idênticas.

## Testes (seam confirmada com o pedido: o formulário de Contratos pela página; vitest + Testing Library)

- AC-01, AC-02, AC-03: `apps/web/src/pages/ContractsPage.test.tsx` (formulário de novo contrato: validação sem empresa, falha da API ao gravar, duas tentativas seguidas).
- AC-04: medição em Chromium a 390 px, resultado no PR (jsdom não calcula layout; o comportamento causador, foco e `scrollIntoView`, é coberto por AC-01 a AC-03).
- AC-05: `git diff` do PR sem arquivo em `components/ds/` nem em `apps/api`.

## Evidência visual e aceite

Capturas do formulário a 390 px depois do erro, antes e depois, anexadas ao card, como evidência técnica. Aceite visual é de Alfredo.

## Riscos

- O foco passa do botão Salvar para o alerta: quem usa teclado precisa voltar com Shift+Tab ao campo; o ganho é que o erro é lido e visto. O Salvar continua um Tab adiante.
- `scrollIntoView` em navegadores sem a opção `block` simplesmente rola até o alerta; sem efeito colateral em dados.
- Sem impacto em RBAC, tenant ou API: só apresentação.
