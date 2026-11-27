import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/formatDateTime';
import { useAuthStore } from '../../stores/authStore';
import type { Ticket, TicketStatus } from '../../hooks/useTickets';
import { priorityLabels, statusLabels } from './TicketCard';
import { TicketPriorityTag, TicketStatusTag } from './TicketTags';
import { SlaBadge } from './SlaBadge';
import { SlaProgress } from './SlaProgress';
import { TicketChecklist } from './TicketChecklist';
import { TicketParentChild } from './TicketParent';
import { RichContentView } from './RichContentView';
import { EzAlert, EzDialog, EzSelect, EzToast } from '../ds';

interface TicketAudit {
  id: string;
  action: string;
  prevVal: string | null;
  newVal: string | null;
  createdAt: string;
  user: { name: string } | null;
}

/**
 * Human-readable (pt-BR) labels for status/priority raw enum values, so
 * the audit trail shows "Aberto" rather than "OPEN" where applicable.
 */
function auditValueLabel(raw: string | null): string {
  if (raw === null) {
    return 'Nenhum';
  }
  if (raw in statusLabels) {
    return statusLabels[raw as TicketStatus];
  }
  if (raw in priorityLabels) {
    return priorityLabels[raw as keyof typeof priorityLabels];
  }
  return raw;
}

/**
 * Renders a single audit entry as a plain-language sentence, e.g.
 * "Status alterado de Aberto para Em Andamento".
 */
function describeAudit(audit: TicketAudit): string {
  const prev = auditValueLabel(audit.prevVal);
  const next = auditValueLabel(audit.newVal);
  switch (audit.action) {
    case 'STATUS_CHANGED':
      return `Status alterado de ${prev} para ${next}`;
    case 'PRIORITY_CHANGED':
      return `Prioridade alterada de ${prev} para ${next}`;
    case 'ASSIGNED':
      return audit.prevVal
        ? 'Chamado reatribuído a outro atendente'
        : 'Chamado atribuído a um atendente';
    case 'SERVICE_DESK_CHANGED':
      return 'Chamado movido para outro departamento';
    default:
      return audit.action;
  }
}

/** Status finais: escolher um deles pede confirmação. */
const CONFIRMED_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED'];

interface TicketDetailProps {
  ticket: Ticket;
}

export function TicketDetail({ ticket }: TicketDetailProps) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const isAgentOrAdmin = ['AGENT', 'AGENT_MASTER', 'ADMIN'].includes(user?.role as string);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await api.get<{ id: string; name: string }[]>('/users/agents');
      return res.data;
    },
    enabled: isAgentOrAdmin,
  });

  const { data: audits = [] } = useQuery({
    queryKey: ['tickets', ticket.id, 'audits'],
    queryFn: async () => {
      const res = await api.get<TicketAudit[]>(`/tickets/${ticket.id}/audits`);
      return res.data;
    },
    enabled: isAgentOrAdmin,
  });

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const assignMutation = useMutation({
    mutationFn: (agentId: string) =>
      api.patch(`/tickets/${ticket.id}/assign`, { agentId }),
    onSuccess: (_data, agentId) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticket.id] });
      const agentName = agents.find((agent) => agent.id === agentId)?.name;
      if (agentName) setNotice(`Chamado atribuído a ${agentName}`);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: TicketStatus) =>
      api.patch(`/tickets/${ticket.id}/status`, { status }),
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', ticket.id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setNotice(`Status alterado para ${statusLabels[status]}`);
    },
  });

  // Resolvido e Fechado pedem confirmação antes do PATCH; a API continua sendo quem valida.
  const [pendingStatus, setPendingStatus] = useState<TicketStatus | null>(null);
  const handleStatusChange = (status: TicketStatus) => {
    if (CONFIRMED_STATUSES.includes(status)) {
      setPendingStatus(status);
      return;
    }
    statusMutation.mutate(status);
  };
  const confirmStatusChange = () => {
    if (pendingStatus) statusMutation.mutate(pendingStatus);
    setPendingStatus(null);
  };

  // Só o status atual e as transições que a API devolveu; sem allowedStatuses (API antiga), lista completa.
  const statusOptions = (Object.keys(statusLabels) as TicketStatus[]).filter(
    (st) => !ticket.allowedStatuses || st === ticket.status || ticket.allowedStatuses.includes(st),
  );

  const statusErrorMessage = statusMutation.isError
    ? 'Não foi possível alterar o status deste chamado. Verifique se a transição é permitida (ex.: é preciso passar por "Em Andamento" antes de "Resolvido").'
    : null;

  // Pausa = slaPausedAt definido e chamado não terminal, o mesmo critério do SlaProgress.
  const slaPaused =
    !['RESOLVED', 'CLOSED'].includes(ticket.status) && !!ticket.slaPausedAt;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <span className="font-mono text-xs text-gray-500">
            {ticket.protocol}
          </span>
          <h1 className="break-words text-xl font-bold text-gray-900 sm:text-2xl">{ticket.title}</h1>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            {user?.role === 'CLIENT' ? (
              <TicketStatusTag status={ticket.status} />
            ) : (
              <EzSelect
                id="ticket-status"
                aria-label="Status"
                variant="compact"
                className="w-auto min-w-[10rem]"
                value={ticket.status}
                disabled={statusMutation.isPending}
                onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
              >
                {statusOptions.map((st) => (
                  <option key={st} value={st}>
                    {statusLabels[st]}
                  </option>
                ))}
              </EzSelect>
            )}
            <TicketPriorityTag priority={ticket.priority} />
          </div>

          {(['AGENT', 'AGENT_MASTER', 'ADMIN'].includes(user?.role as string)) && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <label htmlFor="assignee" className="text-gray-500">
                Atribuído a:
              </label>
              <EzSelect
                id="assignee"
                aria-label="Atribuído a:"
                variant="compact"
                className="w-auto min-w-[10rem]"
                value={ticket.agentId || ''}
                disabled={assignMutation.isPending}
                onChange={(e) => assignMutation.mutate(e.target.value)}
              >
                <option value="">Não atribuído</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </EzSelect>
            </div>
          )}
        </div>
      </div>

      <div className="text-sm text-gray-900">
        <RichContentView content={ticket.description} />
      </div>

      {statusErrorMessage && (
        <EzAlert variant="error" role="alert">
          {statusErrorMessage}
        </EzAlert>
      )}
      {assignMutation.isError && (
        <EzAlert variant="error" role="alert">
          Não foi possível atribuir o chamado. Tente novamente.
        </EzAlert>
      )}
      <EzDialog
        open={pendingStatus !== null}
        title="Confirmar mudança de status"
        message={`O status do chamado passará para ${pendingStatus ? statusLabels[pendingStatus] : ''}.`}
        variant="warning"
        onConfirm={confirmStatusChange}
        onCancel={() => setPendingStatus(null)}
      />
      {notice && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 w-[calc(100%-2rem)] max-w-sm">
          <div>
            <EzToast variant="success" title={notice} onClose={() => setNotice(null)} />
          </div>
        </div>
      )}

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="font-medium text-gray-500">Prazo de resposta</dt>
          <dd className="flex items-center gap-2 text-gray-900">
            {ticket.responseDeadline
              ? formatDateTime(ticket.responseDeadline)
              : 'Não definido'}
            <SlaBadge status={ticket.responseSlaStatus} label="SLA" paused={slaPaused} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="font-medium text-gray-500">Prazo de resolução</dt>
          <dd className="flex items-center gap-2 text-gray-900">
            {ticket.resolveDeadline
              ? formatDateTime(ticket.resolveDeadline)
              : 'Não definido'}
            <SlaBadge status={ticket.resolveSlaStatus} label="SLA" paused={slaPaused} />
          </dd>
        </div>
      </dl>
      <SlaProgress ticket={ticket} />

      {isAgentOrAdmin && (
        <>
          <TicketChecklist ticketId={ticket.id} />
          <TicketParentChild ticket={ticket} />

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900">Histórico</h2>
            {audits.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nenhuma alteração registrada ainda.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {audits.map((audit) => (
                  <li
                    key={audit.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white px-3 py-2"
                  >
                    <span className="text-gray-900">{describeAudit(audit)}</span>
                    <span className="shrink-0 text-right text-xs text-gray-500">
                      {audit.user?.name ?? 'Sistema'}
                      <br />
                      {formatDateTime(audit.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default TicketDetail;
