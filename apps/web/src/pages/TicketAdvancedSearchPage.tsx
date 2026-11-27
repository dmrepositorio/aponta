import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { filtersToSearchParams, parseFiltersFromSearchParams } from '../lib/ticketFilterParams';
import type { TicketFiltersInput, TicketPriority, TicketStatus } from '../hooks/useTickets';
import { statusLabels, priorityLabels } from '../components/tickets/TicketCard';
import type { DeskStage } from '../components/MesaStagesEditor';
import { EzAlert, EzCheck, EzCollapsibleBox, EzComboBox, EzSearch, EzTextInput, EzButton } from '../components/ds';

interface PickerOption {
  id: string;
  name: string;
}

const ticketStatuses = Object.keys(statusLabels) as TicketStatus[];
const ticketPriorities = Object.keys(priorityLabels) as TicketPriority[];

/** D4 "Status" atalhos agregados: convivem na mesma lista de opções que os
 * `TicketStatus` individuais, mas não são um status literal — mapeiam para
 * `notClosed`/`closedOnly` no submit (ver `handleSearch`). */
type StatusFieldValue = TicketStatus | '' | 'OPEN_SHORTCUT' | 'CLOSED_SHORTCUT';

const EMPTY_FORM = {
  dateField: 'createdAt' as 'createdAt' | 'closedAt',
  dateFrom: '',
  dateTo: '',
  number: '',
  titleContains: '',
  status: '' as StatusFieldValue,
  organizationId: '',
  requesterQuery: '',
  agentId: '',
  serviceDeskId: '',
  stageId: '',
  priority: '' as TicketPriority | '',
  mine: false,
  unassigned: false,
  paused: false,
  overdue: false,
};

type AdvancedSearchForm = typeof EMPTY_FORM;

/** ADV-04: o formulário abre com os filtros ativos da lista (query string). */
function formFromFilters(filters: TicketFiltersInput): AdvancedSearchForm {
  let status: StatusFieldValue = filters.status ?? '';
  if (filters.notClosed) status = 'OPEN_SHORTCUT';
  else if (filters.closedOnly) status = 'CLOSED_SHORTCUT';
  return {
    dateField: filters.dateField ?? EMPTY_FORM.dateField,
    dateFrom: filters.dateFrom ?? '',
    dateTo: filters.dateTo ?? '',
    number: filters.number ?? '',
    titleContains: filters.titleContains ?? '',
    status,
    organizationId: filters.organizationId ?? '',
    requesterQuery: filters.requesterQuery ?? '',
    agentId: filters.agentId ?? '',
    serviceDeskId: filters.serviceDeskId ?? '',
    stageId: filters.stageId ?? '',
    priority: filters.priority ?? '',
    mine: Boolean(filters.mine),
    unassigned: Boolean(filters.unassigned),
    paused: Boolean(filters.paused),
    overdue: Boolean(filters.overdue),
  };
}

function filtersFromForm(form: AdvancedSearchForm): TicketFiltersInput {
  const filters: TicketFiltersInput = {};
  if (form.number) filters.number = form.number;
  if (form.titleContains) filters.titleContains = form.titleContains;
  if (form.status === 'OPEN_SHORTCUT') filters.notClosed = true;
  else if (form.status === 'CLOSED_SHORTCUT') filters.closedOnly = true;
  else if (form.status) filters.status = form.status;
  if (form.organizationId) filters.organizationId = form.organizationId;
  if (form.requesterQuery) filters.requesterQuery = form.requesterQuery;
  if (form.agentId) filters.agentId = form.agentId;
  if (form.serviceDeskId) filters.serviceDeskId = form.serviceDeskId;
  if (form.stageId) filters.stageId = form.stageId;
  if (form.priority) filters.priority = form.priority;
  if (form.dateFrom) filters.dateFrom = form.dateFrom;
  if (form.dateTo) filters.dateTo = form.dateTo;
  if (form.dateFrom || form.dateTo) filters.dateField = form.dateField;
  if (form.mine) filters.mine = true;
  if (form.unassigned) filters.unassigned = true;
  if (form.paused) filters.paused = true;
  if (form.overdue) filters.overdue = true;
  return filters;
}

/**
 * Busca avançada (SPEC DMTE-137 D4): absorve o painel TicketFilters antigo.
 * "Buscar" navega para "/" com os filtros na query string — a Lista/Kanban
 * da Tickets page é a única fonte de verdade para exibir os resultados.
 */
export function TicketAdvancedSearchPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isClient = user?.role === 'CLIENT';
  const isClientMaster = user?.role === 'CLIENT_MASTER';
  const location = useLocation();
  const [form, setForm] = useState<AdvancedSearchForm>(() =>
    formFromFilters(parseFiltersFromSearchParams(new URLSearchParams(location.search))),
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const { data: serviceDesks = [], isLoading: desksLoading, isError: desksError } = useQuery({
    queryKey: ['service-desks', 'advanced-search'],
    queryFn: async () => (await api.get<PickerOption[]>('/service-desks')).data,
  });
  const { data: organizations = [], isLoading: orgsLoading, isError: orgsError } = useQuery({
    queryKey: ['organizations', 'advanced-search'],
    queryFn: async () => (await api.get<PickerOption[]>('/organizations')).data,
    enabled: !isClient && !isClientMaster,
  });
  const { data: agents = [], isLoading: agentsLoading, isError: agentsError } = useQuery({
    queryKey: ['agents', 'advanced-search'],
    queryFn: async () => (await api.get<PickerOption[]>('/users/agents')).data,
    // GET /users/agents rejects CLIENT_MASTER with 403 (it's an agent-scoped
    // endpoint) — hide the field instead of leaving it permanently empty.
    enabled: !isClient && !isClientMaster,
  });
  const { data: stages = [], isLoading: stagesLoading, isError: stagesError } = useQuery({
    queryKey: ['service-desk-stages', 'advanced-search', form.serviceDeskId],
    queryFn: async () =>
      (await api.get<DeskStage[]>(`/service-desks/${form.serviceDeskId}/stages`)).data,
    enabled: Boolean(form.serviceDeskId),
  });

  const filters = filtersFromForm(form);
  const hasAnyFilter = Object.keys(filters).length > 0;
  const dateRangeInvalid = Boolean(form.dateFrom && form.dateTo && form.dateTo < form.dateFrom);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (dateRangeInvalid) return;
    if (!hasAnyFilter) {
      setSubmitAttempted(true);
      return;
    }
    navigate(`/?${filtersToSearchParams(filters).toString()}`);
  };

  const handleClear = () => {
    setForm(EMPTY_FORM);
    setSubmitAttempted(false);
  };

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar para Tickets
      </Link>
      <h1 className="text-[20px] font-semibold text-gray-900">Busca avançada</h1>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <EzComboBox
            id="adv-search-date-field"
            label="Data"
            value={form.dateField}
            onChange={(e) =>
              setForm((f) => ({ ...f, dateField: e.target.value as 'createdAt' | 'closedAt' }))
            }
          >
            <option value="createdAt">Abertura</option>
            <option value="closedAt">Fechamento</option>
          </EzComboBox>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start lg:col-span-2">
            <EzTextInput
              id="adv-search-date-from"
              label="De"
              type="date"
              value={form.dateFrom}
              onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
            />
            <EzTextInput
              id="adv-search-date-to"
              label="Até"
              type="date"
              value={form.dateTo}
              hasError={dateRangeInvalid}
              message={dateRangeInvalid ? 'A data final não pode ser anterior à data inicial' : undefined}
              onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
            />
          </div>

          <EzTextInput
            id="adv-search-number"
            label="Número do ticket"
            value={form.number}
            onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
          />
          <EzTextInput
            id="adv-search-title"
            label="Título"
            value={form.titleContains}
            onChange={(e) => setForm((f) => ({ ...f, titleContains: e.target.value }))}
          />

          <EzComboBox
            id="adv-search-status"
            label="Status"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as StatusFieldValue }))}
          >
            <option value="">Qualquer status</option>
            <optgroup label="Atalhos">
              <option value="OPEN_SHORTCUT">Abertos</option>
              <option value="CLOSED_SHORTCUT">Fechados</option>
            </optgroup>
            <optgroup label="Status">
              {ticketStatuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </optgroup>
          </EzComboBox>

          <EzComboBox
            id="adv-search-priority"
            label="Prioridade"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TicketPriority | '' }))}
          >
            <option value="">Qualquer prioridade</option>
            {ticketPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabels[priority]}
              </option>
            ))}
          </EzComboBox>

          {!isClient && !isClientMaster && (
            <EzSearch
              id="adv-search-organization"
              label="Cliente"
              placeholder={orgsLoading ? 'Carregando clientes…' : 'Todos os clientes'}
              disabled={orgsLoading}
              hasError={orgsError}
              message={orgsError ? 'Não foi possível carregar os clientes' : undefined}
              options={organizations.map((org) => ({ label: org.name, value: org.id }))}
              value={form.organizationId || null}
              onChange={(value) => setForm((f) => ({ ...f, organizationId: value ? String(value) : '' }))}
            />
          )}

          {!isClient && (
            <EzTextInput
              id="adv-search-requester"
              label="Solicitante"
              placeholder="Nome ou e-mail"
              value={form.requesterQuery}
              onChange={(e) => setForm((f) => ({ ...f, requesterQuery: e.target.value }))}
            />
          )}

          {!isClient && !isClientMaster && (
            <EzSearch
              id="adv-search-agent"
              label="Atendente"
              placeholder={agentsLoading ? 'Carregando atendentes…' : 'Todos os atendentes'}
              disabled={agentsLoading}
              hasError={agentsError}
              message={agentsError ? 'Não foi possível carregar os atendentes' : undefined}
              options={agents.map((agent) => ({ label: agent.name, value: agent.id }))}
              value={form.agentId || null}
              onChange={(value) => setForm((f) => ({ ...f, agentId: value ? String(value) : '' }))}
            />
          )}

          <EzComboBox
            id="adv-search-service-desk"
            label="Mesa de serviço"
            value={form.serviceDeskId}
            disabled={desksLoading}
            hasError={desksError}
            message={desksError ? 'Não foi possível carregar as mesas' : undefined}
            onChange={(e) =>
              setForm((f) => ({ ...f, serviceDeskId: e.target.value, stageId: '' }))
            }
          >
            <option value="">{desksLoading ? 'Carregando mesas…' : 'Todas as mesas'}</option>
            {serviceDesks.map((desk) => (
              <option key={desk.id} value={desk.id}>
                {desk.name}
              </option>
            ))}
          </EzComboBox>

          <EzComboBox
            id="adv-search-stage"
            label="Estágio"
            value={form.stageId}
            disabled={!form.serviceDeskId || stagesLoading}
            hasError={stagesError}
            message={
              stagesError
                ? 'Não foi possível carregar os estágios'
                : !form.serviceDeskId
                  ? 'Selecione uma mesa de serviço primeiro'
                  : undefined
            }
            onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
          >
            <option value="">{stagesLoading ? 'Carregando estágios…' : 'Todos os estágios'}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </EzComboBox>
        </div>

        <EzCollapsibleBox title="Filtros adicionais">
          <div className="flex flex-wrap gap-4">
            <EzCheck
              id="adv-search-mine"
              label="Meus"
              checked={form.mine}
              onChange={(e) => setForm((f) => ({ ...f, mine: e.target.checked }))}
            />
            <EzCheck
              id="adv-search-unassigned"
              label="Não atendidos"
              checked={form.unassigned}
              onChange={(e) => setForm((f) => ({ ...f, unassigned: e.target.checked }))}
            />
            <EzCheck
              id="adv-search-paused"
              label="Pausados"
              checked={form.paused}
              onChange={(e) => setForm((f) => ({ ...f, paused: e.target.checked }))}
            />
            <EzCheck
              id="adv-search-overdue"
              label="Vencidos"
              checked={form.overdue}
              onChange={(e) => setForm((f) => ({ ...f, overdue: e.target.checked }))}
            />
          </div>
        </EzCollapsibleBox>

        {submitAttempted && !hasAnyFilter && (
          <EzAlert variant="warning">Preencha ao menos um filtro</EzAlert>
        )}

        <div className="flex gap-2">
          <EzButton type="submit">Buscar</EzButton>
          <EzButton type="button" variant="secondary" onClick={handleClear}>
            Limpar
          </EzButton>
        </div>
      </form>
    </div>
  );
}

export default TicketAdvancedSearchPage;
