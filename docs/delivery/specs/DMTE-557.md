# Detalhe do ticket: SLA de resolução coerente entre selo, texto e barra (pausa)

Identidade: DMTE-557, Tier 1 (recomendado), origem item 1 (P1) da auditoria DMTE-549, aprovado pelo Alfredo ("Vamos implementar"). Issue GitHub: a criar (ainda não existe). Base: `origin/main` @ 26dd770. Status da SPEC: decisões D1 a D5 tomadas pelo Alfredo; pronta para /plan.

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
- `SlaProgress`: pausa = `slaPausedAt` não nulo (mesmo critério de `getSlaStatus`), para qualquer status de pausa; em pausa mostra "Pausado · <rótulo do status>" e, em texto secundário neutro, o tempo congelado no instante da pausa; barra neutra com valor congelado, sem vermelho. O rótulo vem de `statusLabels` (`TicketCard.tsx:3-13`, já exportado).
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
- AC-01: Com `slaPausedAt` definido e status PENDING_SANKHYA, ON_HOLD ou PENDING_CUSTOMER, o texto principal começa com "Pausado · <rótulo do status>" (D1) e, ao lado, em texto secundário neutro (cinza), o tempo congelado no instante da pausa: "restam Xh Ym" ou "vencido há Xh Ym" (calculado como prazo + pausas acumuladas - `slaPausedAt`, independente do relógio). Não aparece "Restam" nem "Vencido há" em destaque.
- AC-02: Em pausa, a barra usa cor neutra (cinza) e nenhum texto usa classe vermelha, mesmo com `resolveSlaStatus` BREACHED ou prazo gravado no passado. Ticket já vencido ao entrar em pausa (D4): barra e texto neutros; o selo vermelho da API continua sinalizando o vencimento (D2, selo inalterado).
- AC-03: Em pausa, o valor da barra é congelado: com o mesmo ticket e dois relógios diferentes durante a pausa, `aria-valuenow` é igual.
- AC-04: Cenário da DMTE-557 (PENDING_SANKHYA, `slaPausedAt` definido, `slaAccumulatedPauseTime` > 0, `resolveSlaStatus` ON_TRACK, prazo gravado no passado): selo "Dentro do prazo" e texto "Pausado · Aguardando Sankhya", sem "Vencido há" (a fixture tem `slaPausedAt` anterior ao prazo efetivo, para o tempo congelado ser positivo).
- AC-05: Sem pausa (`slaPausedAt` nulo), comportamento inalterado: "Restam Xh Ym" ou "Vencido há Xh Ym" (vermelho), cor da barra pelo `resolveSlaStatus`.
- AC-06: Ticket RESOLVED/CLOSED mantém barra cinza e nunca exibe "Vencido" nem "Pausado".
- AC-07: `EzProgressBar` expõe `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow` igual ao valor clampado e arredondado; aceita `aria-label`.
- AC-08: A barra do SLA tem nome acessível "Progresso do SLA (Resolução)" e `aria-valuetext` com o texto exibido (ex. "Pausado · Aguardando Sankhya").
- AC-09: O critério de pausa do front não diverge de `SLA_PAUSE_STATUSES`: teste parametrizado nos três status de pausa; status sem pausa (IN_PROGRESS) com `slaPausedAt` nulo não mostra "Pausado".
- AC-10: Regressão: suítes de Kanban, lista e `sla-status.spec.ts` seguem verdes sem alteração.

## Matriz AC -> teste -> evidência
| AC | Camada / arquivo | Evidência esperada |
|---|---|---|
| AC-01, AC-02 (inclui D4), AC-03, AC-04, AC-09 | Vitest, novo `apps/web/src/components/tickets/SlaProgress.test.tsx` (relógio falso, `it.each` nos 3 status) | RED por asserção contra o `SlaProgress` atual (PENDING_SANKHYA e ON_HOLD mostram "Vencido"); GREEN após a correção. Comando via Nx para o projeto `web` (confirmar na implementação) |
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

## Decisões (Alfredo)
- D1 decidida: em pausa o texto é "Pausado · <status>" e também mostra o tempo congelado em texto secundário neutro.
- D2 decidida: manter o selo da API (estado congelado) ao lado de "Pausado"; não mexer em `SlaBadge`/`EzSlaChip`.
- D3 decidida: critério de pausa no front é `slaPausedAt` (não o status), sem campo novo na API. Tier segue 1.
- D4 decidida: ticket já vencido ao entrar em pausa tem barra e texto neutros; o selo vermelho da API segue sinalizando o vencimento.
- D5 decidida: `PENDING_APPROVAL` no KPI "Pausados" fica fora desta entrega; vira issue separada.

## Tier
Tier 1: um componente de front, atributos ARIA no DS, só testes de front, sem API, schema, RBAC ou flag. Subiria a Tier 2 se surgir campo novo na API (ex. `slaPaused` no DTO) ou se D5 entrar; hoje nenhum dos dois.
