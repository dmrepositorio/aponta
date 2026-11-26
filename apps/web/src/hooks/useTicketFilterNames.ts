import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import type { TicketFiltersInput } from './useTickets';

interface NamedOption {
  id: string;
  name: string;
  displayName?: string | null;
}

export interface TicketFilterNames {
  serviceDeskId?: string;
  organizationId?: string;
  agentId?: string;
  stageId?: string;
}

/**
 * Nomes dos filtros da fila que guardam só um id (mesa, cliente, atendente, estágio),
 * para as tags de filtro ativo. Cada lista só é consultada quando o filtro existe, e
 * clientes (CLIENT, CLIENT_MASTER) não consultam organizações nem atendentes: a API
 * recusa com 403, como na Busca avançada. Sem nome (carregando, recusado ou fora da
 * lista) o campo fica ausente e a tag usa o rótulo genérico.
 */
export function useTicketFilterNames(filters: TicketFiltersInput): TicketFilterNames {
  const role = useAuthStore((state) => state.user?.role);
  const canListDirectories = role !== 'CLIENT' && role !== 'CLIENT_MASTER';
  const { serviceDeskId, organizationId, agentId, stageId } = filters;

  const { data: serviceDesks } = useQuery({
    queryKey: ['service-desks'],
    queryFn: async () => (await api.get<NamedOption[]>('/service-desks')).data,
    enabled: Boolean(serviceDeskId),
  });
  const { data: organizations } = useQuery({
    queryKey: ['organizations', 'ticket-filter-names'],
    queryFn: async () => (await api.get<NamedOption[]>('/organizations')).data,
    enabled: Boolean(organizationId) && canListDirectories,
  });
  const { data: agents } = useQuery({
    queryKey: ['agents', 'ticket-filter-names'],
    queryFn: async () => (await api.get<NamedOption[]>('/users/agents')).data,
    enabled: Boolean(agentId) && canListDirectories,
  });
  // O estágio pertence a uma mesa: sem a mesa no filtro não há onde procurar o nome.
  const { data: stages } = useQuery({
    queryKey: ['service-desk-stages', 'ticket-filter-names', serviceDeskId],
    queryFn: async () => (await api.get<NamedOption[]>(`/service-desks/${serviceDeskId}/stages`)).data,
    enabled: Boolean(serviceDeskId) && Boolean(stageId),
  });

  const nameOf = (list: NamedOption[] | undefined, id: string | undefined) => {
    const found = id ? list?.find((item) => item.id === id) : undefined;
    return (found?.displayName || found?.name) ?? undefined;
  };

  return {
    serviceDeskId: nameOf(serviceDesks, serviceDeskId),
    organizationId: nameOf(organizations, organizationId),
    agentId: nameOf(agents, agentId),
    stageId: nameOf(stages, stageId),
  };
}
