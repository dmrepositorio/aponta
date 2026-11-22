# Detalhe do ticket: SLA de resolução coerente entre selo, texto e barra (pausa)

Identidade: DMTE-557, Tier 1 (recomendado), origem item 1 (P1) da auditoria DMTE-549, aprovado pelo Alfredo ("Vamos implementar"). Issue GitHub: a criar (ainda não existe). Base: `origin/main` @ 26dd770. Status da SPEC: proposta, aguardando decisões D1 a D5.

## Objetivo
No detalhe do ticket em pausa de SLA (ex.: AP-2026-0001, "Aguardando Sankhya"), selo, texto e barra hoje se contradizem: selo "Dentro do prazo" (verde), texto "Vencido há 6h 22m" (vermelho), barra 100% verde. Passam a seguir um único critério de pausa, o mesmo da API. Usuário: atendente/admin que abre o ticket. Sucesso: nenhuma combinação contraditória em nenhum status de pausa.

## Situação atual (código observado)
- Pausa na API: `SLA_PAUSE_STATUSES` = ON_HOLD, PENDING_CUSTOMER, PENDING_SANKHYA (`apps/api/src/service-desks/desk-policy.ts:112-116`). Entrar na pausa grava `slaPausedAt`; sair soma os minutos em `slaAccumulatedPauseTime` e zera `slaPausedAt` (`apps/api/src/tickets/tickets.service.ts:1146-1162`).
- Selo: `decorateWithSlaStatus` (`tickets.service.ts:~266-309`) chama `getSlaStatus(createdAt, deadline, now, slaAccumulatedPauseTime, slaPausedAt)` (`apps/api/src/scheduling/sla-status.ts:23-56`). Ali "em pausa" = `slaPausedAt` não nulo: o prazo efetivo ganha `now - slaPausedAt`, então o estado fica congelado. Ticket terminal (RESOLVED/CLOSED) devolve `null`.
- Divergência: `apps/web/src/components/tickets/SlaProgress.tsx:12` usa `isPaused = ticket.status === 'PENDING_CUSTOMER'`. Em PENDING_SANKHYA e ON_HOLD a pausa em curso vale 0 (linhas 14-16), o prazo efetivo não avança, o texto vira "Vencido há ..." (linhas 40-48, vermelho na linha 56) e a cor da barra vem do selo (linhas 31-37).
- Uso: `TicketDetail.tsx:204` (selo de resolução) e `:208` (`<SlaProgress>`). `SlaProgress` só é usado ali.
- Outros pontos com a mesma regra, já coerentes (critério `slaPausedAt`): Kanban `TicketKanbanCard.tsx:12-20` (`effectiveDeadline`) com teste de pausa em `TicketKanbanCard.test.tsx:~104-132`; cron `sla-escalation.cron.ts:~33-38`; relatórios `reports.service.ts:~350-365`. A lista de tickets usa o selo da API.
- Inconsistência colateral (fora de escopo): KPI "Pausados" em `reports.service.ts:~340-346` inclui PENDING_APPROVAL, que não está em `SLA_PAUSE_STATUSES`.
- `EzProgressBar` (`apps/web/src/components/ds/EzProgressBar.tsx:28-47`) não tem `role` nem `aria-value*`; só `SlaProgress` o usa.
- `SlaProgress` não tem teste; `sla-status.spec.ts` não tem caso de pausa em curso.

## Escopo
- `SlaProgress`: pausa = `slaPausedAt` não nulo (mesmo critério de `getSlaStatus`), para qualquer status de pausa; em pausa mostra "Pausado · <rótulo do status>", barra neutra com valor congelado, sem vermelho.
- `EzProgressBar`: `role="progressbar"`, `aria-valuenow/min/max`; nome acessível repassado por `SlaProgress`.
- Testes e story do DS.

## Exclusões
- Sem mudança de API, DTO, schema, `getSlaStatus`, Kanban, lista, cron ou relatórios.
- Não alinhar PENDING_APPROVAL à pausa (D5). Não mudar o selo `SlaBadge`/`EzSlaChip` (D2). Item 2 da DMTE-549 (HTML escapado) é outra entrega.
- Sem feature flag: correção de exibição sem efeito externo.

## Tenant / RBAC
Não se aplica: sem endpoint, query ou permissão novos; o detalhe do ticket já é autorizado pela API e nenhum dado novo é exposto (`slaPausedAt` já vem no payload, `useTickets.ts:47`).

## Contratos
- API/DTO: inalterados. O front lê `status`, `slaPausedAt`, `slaAccumulatedPauseTime`, `resolveDeadline`, `resolveSlaStatus` do tipo `Ticket` (`apps/web/src/hooks/useTickets.ts`).
- DS: `EzProgressBar` ganha atributos ARIA derivados de `value` (clampado); `{...props}` do chamador pode sobrescrever (ex. `aria-label`). Story nova "Neutra/Pausada" com `colorClass` cinza.

## Critérios de aceite
- AC-01: Com `slaPausedAt` definido e status PENDING_SANKHYA, ON_HOLD ou PENDING_CUSTOMER, o texto é "Pausado · <rótulo do status>" e não contém "Vencido" nem "Restam" (ver D1).
- AC-02: Em pausa, a barra usa cor neutra (cinza) e o texto não usa classe vermelha, mesmo com `resolveSlaStatus` BREACHED ou prazo gravado no passado (ver D4 para o estado já vencido).
- AC-03: Em pausa, o valor da barra é congelado: com o mesmo ticket e dois relógios diferentes durante a pausa, `aria-valuenow` é igual.
- AC-04: Cenário da DMTE-557 (PENDING_SANKHYA, `slaPausedAt` definido, `slaAccumulatedPauseTime` > 0, `resolveSlaStatus` ON_TRACK, prazo gravado no passado): selo "Dentro do prazo" e texto "Pausado · Aguardando Sankhya", sem "Vencido há".
- AC-05: Sem pausa (`slaPausedAt` nulo), comportamento inalterado: "Restam Xh Ym" ou "Vencido há Xh Ym" (vermelho), cor da barra pelo `resolveSlaStatus`.
- AC-06: Ticket RESOLVED/CLOSED mantém barra cinza e nunca exibe "Vencido" nem "Pausado".
- AC-07: `EzProgressBar` expõe `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow` igual ao valor clampado e arredondado; aceita `aria-label`.
- AC-08: A barra do SLA tem nome acessível "Progresso do SLA (Resolução)" e `aria-valuetext` com o texto exibido (ex. "Pausado · Aguardando Sankhya").
- AC-09: O critério de pausa do front não diverge de `SLA_PAUSE_STATUSES`: teste parametrizado nos três status de pausa; status sem pausa (IN_PROGRESS) com `slaPausedAt` nulo não mostra "Pausado".
- AC-10: Regressão: suítes de Kanban, lista e `sla-status.spec.ts` seguem verdes sem alteração.

## Matriz AC -> teste -> evidência
| AC | Camada / arquivo | Evidência esperada |
|---|---|---|
| AC-01, AC-02, AC-03, AC-04, AC-09 | Vitest, novo `apps/web/src/components/tickets/SlaProgress.test.tsx` (relógio falso, `it.each` nos 3 status) | RED por asserção contra o `SlaProgress` atual (PENDING_SANKHYA e ON_HOLD mostram "Vencido"); GREEN após a correção. Comando via Nx para o projeto `web` (confirmar na implementação) |
| AC-04 (no detalhe) | Vitest, caso novo em `apps/web/src/pages/TicketDetailPage.test.tsx` | RED/GREEN: selo e texto coerentes no detalhe |
| AC-05, AC-06 | Vitest, mesmo `SlaProgress.test.tsx` | Caracterização: verde antes e depois (não é RED; registrar como regressão) |
| AC-07 | Vitest, `apps/web/src/components/ds/EzProgressBar.test.tsx` (existente) | RED por asserção de `role`/`aria-valuenow` ausentes; GREEN |
| AC-08 | Vitest, `SlaProgress.test.tsx` (`getByRole('progressbar', {name})`) | RED/GREEN |
| AC-10 | Vitest e Jest existentes, typecheck e build | CI `Typecheck, unit tests, build` verde no SHA final |
| Reprodução da API (opcional) | Jest, caso de pausa em curso em `apps/api/src/scheduling/sla-status.spec.ts` | Caracterização: ON_TRACK congelado com `slaPausedAt`; passa antes e depois |

Playwright: não necessário no Tier 1 (sem jornada nova). Aceite visual humano do detalhe em pausa fica com o Alfredo.

## Riscos
- Status de pausa sem `slaPausedAt` (dado legado ou ticket criado já em pausa): API e front tratam como não pausado e exibem prazo ativo, coerente entre si (D3).
- Mudar o DS (`EzProgressBar`) afeta futuros usuários; hoje só há um. Story obrigatória (AGENTS.md).
- O texto "Pausado" pode esconder o tempo restante, que o atendente talvez queira ver (D1).

## Decisões abertas (para o Alfredo)
- D1 Texto em pausa: só "Pausado · Aguardando Sankhya" ou também o tempo congelado ("... · restam 2h 10m")? Recomendo incluir o tempo congelado em texto secundário neutro, porque o atendente decide se escala ou espera.
- D2 Selo: manter o selo da API (estado congelado, "Dentro do prazo") ao lado de "Pausado" ou trocar o selo por "Pausado"? Recomendo manter o selo e não mexer em `SlaBadge`/`EzSlaChip`, pois é o que Kanban e lista mostram e evita mudança de API; texto e barra explicam a pausa.
- D3 Critério de pausa no front: `slaPausedAt` (igual à API, sem campo novo) ou status em `SLA_PAUSE_STATUSES`? Recomendo `slaPausedAt`, para nunca divergir de `getSlaStatus`.
- D4 Ticket que já estava vencido ao entrar em pausa: barra e texto neutros (como no card) ou preservar o aviso? Recomendo barra neutra e texto "Pausado · <status>"; o selo vermelho da API continua sinalizando o vencimento congelado; sem vermelho no texto.
- D5 PENDING_APPROVAL: o KPI "Pausados" o conta, mas o SLA não pausa nele. Recomendo issue separada para decidir; fora desta entrega.

D1 a D4 bloqueiam só o texto exato e a cor de AC-01/AC-02; a implementação segue com as recomendações se aprovadas.

## Tier
Tier 1: um componente de front, atributos ARIA no DS, só testes de front, sem API, schema, RBAC ou flag. Subiria a Tier 2 se D2/D3 pedirem campo novo na API (ex. `slaPaused` no DTO) ou se D5 entrar.
