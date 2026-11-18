import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { z } from 'zod';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { ServiceDeskEditor } from '../components/ServiceDeskEditor';
import { BusinessHoursEditor } from '../components/BusinessHoursEditor';
import { ServiceDeskSlaEditor } from '../components/ServiceDeskSlaEditor';
import { MesaFlagEditor } from '../components/MesaFlagEditor';
import { MesaStagesEditor } from '../components/MesaStagesEditor';
import { MesaBasicsForm, MesaStatusForm } from '../components/MesaDeskForms';
import { MesaSaveProvider, useMesaPending } from '../components/mesaSave';
import {
  ServiceDeskActiveTag,
  ServiceDeskReceivingTag,
  inactiveRowText,
} from '../components/ServiceDeskStateTags';
import {
  EzAlert,
  EzBadge,
  EzButton,
  EzCardItem,
  EzComboBox,
  EzDialog,
  EzDynamicFilter,
  EzEmptyCard,
  EzEntityScreenConfigModal,
  EzEntityToolbar,
  EzFilterDrawer,
  EzPageHeader,
  EzPageLayout,
  EzSpinner,
  EzTabs,
  EzTextArea,
  EzTextInput,
  ezTabId,
  ezTabPanelId,
} from '../components/ds';
import { EzEntityGrid } from '../components/ds/EzEntityGrid';
import { applyDynamicFilters } from '../components/ds/EzDynamicFilter';
import type { EzDynamicFilterField, EzDynamicFilterRule } from '../components/ds/EzDynamicFilter';
import { useUserScreenConfig } from '../hooks/useUserScreenConfig';
import { ticketSectionLabel } from '../lib/mesaLabels';

const MESA_TABS_ID = 'mesa-tabs';

interface ServiceDesk {
  id: string;
  name: string;
  displayName?: string | null;
  description?: string | null;
  active?: boolean;
  acceptingNewTickets?: boolean;
  agents?: { id: string; name: string }[];
  organizations?: { id: string; name: string }[];
  organization?: { id: string; name: string } | null;
  slaCriticalResponseHours?: number | null;
  slaCriticalResolveHours?: number | null;
  slaHighResponseHours?: number | null;
  slaHighResolveHours?: number | null;
  slaMediumResponseHours?: number | null;
  slaMediumResolveHours?: number | null;
  slaLowResponseHours?: number | null;
  slaLowResolveHours?: number | null;
  defaultOpenStatus?: string;
  defaultClosedStatus?: string;
  reviewType?: string | null;
  reviewDeadlineDays?: number | null;
  priorities?: { id: string; ticketPriority: string; label: string; enabled: boolean }[];
  ticketSections?: { id: string; key: string; enabled: boolean; sortOrder: number }[];
  createdAt: string;
}

const serviceDeskFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  displayName: z.string().trim().optional(),
  description: z.string().trim().optional(),
});

type ServiceDeskFormValues = z.infer<typeof serviceDeskFormSchema>;

/** Clientes da mesa: lista nova (`organizations`) ou o vínculo único legado (`organization`). */
function deskClientNames(desk: ServiceDesk): string[] {
  const names = desk.organizations?.map((org) => org.name) ?? [];
  return names.length > 0 ? names : desk.organization ? [desk.organization.name] : [];
}

function serviceDeskColumns(
  onSelect: (deskId: string) => void,
): ColumnDef<ServiceDesk>[] {
  // Mesa inativa: texto da linha mais fraco (ver inactiveRowText; gray-400 reprova 4,5:1).
  const rowText = (desk: ServiceDesk) => (desk.active === false ? inactiveRowText : '');
  return [
    {
      accessorKey: 'name',
      header: 'Nome',
      size: 140,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onSelect(row.original.id)}
          title={row.original.name}
          className={`block max-w-full truncate text-left font-medium hover:underline ${
            rowText(row.original) || 'text-brand-700'
          }`}
        >
          {row.original.name}
        </button>
      ),
    },
    {
      accessorKey: 'displayName',
      header: 'Nome de exibição',
      size: 200,
      cell: ({ row }) => (
        <span
          title={row.original.displayName || undefined}
          className={`block max-w-full truncate ${rowText(row.original)}`}
        >
          {row.original.displayName || '—'}
        </span>
      ),
    },
    {
      id: 'active',
      header: 'Ativa',
      size: 100,
      cell: ({ row }) => <ServiceDeskActiveTag active={row.original.active !== false} />,
    },
    {
      id: 'accepting',
      header: 'Recebendo',
      size: 130,
      cell: ({ row }) => <ServiceDeskReceivingTag receiving={row.original.acceptingNewTickets !== false} />,
    },
    {
      id: 'organization',
      header: 'Clientes',
      size: 150,
      cell: ({ row }) => {
        const names = deskClientNames(row.original);
        if (names.length === 0) {
          return <span className={rowText(row.original) || undefined}>—</span>;
        }
        const all = names.join(', ');
        return (
          <span title={all} className="flex max-w-full items-center gap-1.5 whitespace-nowrap">
            <span className={`truncate ${rowText(row.original)}`}>{names[0]}</span>
            {names.length > 1 && (
              <EzBadge
                size="small"
                title={all}
                colorClass={`bg-gray-90 shrink-0 ${rowText(row.original) || 'text-gray-700'}`}
              >{`+${names.length - 1}`}</EzBadge>
            )}
          </span>
        );
      },
    },
    {
      id: 'agents',
      header: 'Agentes',
      size: 110,
      cell: ({ row }) => (
        <span className={rowText(row.original) || undefined}>{row.original.agents?.length ?? 0}</span>
      ),
    },
  ];
}

// Campos filtráveis dinamicamente (um por coluna da grade) - padrão Sankhya,
// mesmo modelo de OrganizationsPage.tsx (ORG_FILTER_FIELDS).
const SERVICE_DESK_FILTER_FIELDS: EzDynamicFilterField[] = [
  { id: 'name', label: 'Nome', getValue: (d: ServiceDesk) => d.name },
  { id: 'displayName', label: 'Nome de exibição', getValue: (d: ServiceDesk) => d.displayName },
  {
    id: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'Ativo', value: 'Ativo' },
      { label: 'Inativo', value: 'Inativo' },
    ],
    getValue: (d: ServiceDesk) => (d.active === false ? 'Inativo' : 'Ativo'),
  },
  {
    id: 'accepting',
    label: 'Recebendo',
    type: 'select',
    options: [
      { label: 'Sim', value: 'Sim' },
      { label: 'Não', value: 'Não' },
    ],
    getValue: (d: ServiceDesk) => (d.acceptingNewTickets === false ? 'Não' : 'Sim'),
  },
  { id: 'agents', label: 'Agentes', type: 'number', getValue: (d: ServiceDesk) => d.agents?.length ?? 0 },
];

/**
 * ADMIN-only page for managing departments (API resource: "service desk").
 *
 * Standardized on the Sankhya ERP grid pattern (parity with
 * OrganizationsPage / TicketsPage): EzEntityToolbar for Incluir / Recarregar
 * / Excluir / Duplicar / Configurar colunas, plus per-user column
 * configuration via useUserScreenConfig. Scope kept proportional to this
 * screen's size — no Endereços/Contatos/Relacionamentos tabs, since a
 * department has none of that; the existing ADMIN-only guard and the
 * ServiceDeskEditor / ServiceDeskSlaEditor / BusinessHoursEditor detail
 * editors are untouched.
 */
function ServiceDesksPageContent() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';

  // Sankhya parity: Modo Grade (lista) / Modo Formulário (criação ou
  // detalhe), controlado pela EzEntityToolbar — mesmo padrão de
  // OrganizationsPage/TicketsPage.
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [selectedDesks, setSelectedDesks] = useState<ServiceDesk[]>([]);
  const [isScreenConfigModalOpen, setIsScreenConfigModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('basics');

  // DMTE-533: alteração não salva pede confirmação antes de trocar de aba, voltar ou abrir outra mesa.
  const hasPending = useMesaPending();
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const guard = (action: () => void) => (hasPending ? setDiscardAction(() => action) : action());

  // Sankhya parity: painel de filtros lateral (EzFilterDrawer) com filtros
  // dinâmicos e filtros salvos, mesmo padrão de OrganizationsPage.tsx.
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [dynamicRules, setDynamicRules] = useState<EzDynamicFilterRule[]>([]);
  const [activeSavedFilterId, setActiveSavedFilterId] = useState<string | null>(null);

  const mesaTabs = [
    { id: 'basics', label: 'Informações básicas' },
    { id: 'params', label: 'Parâmetros' },
    { id: 'required', label: 'Campos obrigatórios' },
    { id: 'priorities', label: 'Prioridades' },
    { id: 'clients', label: 'Clientes' },
    { id: 'groups', label: 'Grupos de atendentes' },
    { id: 'stages', label: 'Estágio' },
    { id: 'status', label: 'Status' },
    { id: 'reopen', label: 'Reabertura' },
    { id: 'sections', label: 'Seções do ticket' },
    { id: 'review', label: 'Revisão' },
    { id: 'hours', label: 'Expediente' },
  ];

  const {
    config: screenConfig,
    setColumnVisibility,
    setDensity,
    setFormLayout,
    saveFilter,
    deleteFilter,
    restoreDefaults,
  } = useUserScreenConfig('service-desks', {
    grid: {
      columnVisibility: {},
      density: 'compact',
    },
    form: {
      layout: 'CASCADE',
    },
    viewMode: 'GRID',
  });

  const { data: serviceDesks, isLoading } = useQuery({
    queryKey: ['service-desks'],
    queryFn: async () => {
      const { data } = await api.get<ServiceDesk[]>('/service-desks');
      return data;
    },
    enabled: isAdmin,
  });

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const { data } = await api.get<{ id: string; name: string; email: string }[]>('/users/agents');
      return data;
    },
    enabled: isAdmin,
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ServiceDeskFormValues>({
    resolver: zodResolver(serviceDeskFormSchema),
    defaultValues: { name: '', displayName: '', description: '' },
  });

  const createMutation = useMutation({
    mutationFn: async (values: ServiceDeskFormValues) => {
      const payload = {
        name: values.name,
        ...(values.displayName ? { displayName: values.displayName } : {}),
        ...(values.description ? { description: values.description } : {}),
      };
      const { data } = await api.post<ServiceDesk>('/service-desks', payload);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-desks'] });
      reset();
      setMode('list');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (deskId: string) => {
      await api.delete(`/service-desks/${deskId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['service-desks'] });
    },
  });

  const openDetail = (deskId: string) => {
    setSelectedDeskId(deskId);
    setActiveTab('basics');
    setMode('form');
  };

  const backToList = () => {
    setMode('list');
    setSelectedDeskId(null);
  };

  const handleInsert = () => {
    reset();
    setSelectedDeskId(null);
    setMode('form');
  };

  const handleClone = () => {
    const active = selectedDesks[0];
    if (!active) return;
    reset();
    setValue('name', `${active.name} (Cópia)`);
    setSelectedDeskId(null);
    setMode('form');
  };

  const handleDelete = () => {
    if (selectedDesks.length === 0) return;
    const confirmMsg = `Deseja excluir ${selectedDesks.length} mesa(s) selecionada(s)?`;
    if (window.confirm(confirmMsg)) {
      selectedDesks.forEach((desk) => deleteMutation.mutate(desk.id));
      setSelectedDesks([]);
    }
  };

  // Sankhya parity: mesmo pipeline de filtragem de OrganizationsPage.tsx
  // (filteredOrgs) — status, busca por texto e, por fim, filtros dinâmicos.
  const filteredDesks = useMemo(() => {
    const base = (serviceDesks ?? []).filter((desk) => {
      if (filterStatus === 'ACTIVE' && desk.active === false) return false;
      if (filterStatus === 'INACTIVE' && desk.active !== false) return false;
      if (filterSearch.trim()) {
        const query = filterSearch.toLowerCase().trim();
        const matchesName = desk.name.toLowerCase().includes(query);
        const matchesDisplayName = desk.displayName?.toLowerCase().includes(query);
        if (!matchesName && !matchesDisplayName) return false;
      }
      return true;
    });
    return applyDynamicFilters(base, dynamicRules, SERVICE_DESK_FILTER_FIELDS);
  }, [serviceDesks, filterStatus, filterSearch, dynamicRules]);

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-[20px] font-semibold text-gray-900">Mesa</h1>
        <p className="text-sm text-gray-500">
          Você não tem permissão para ver esta página. Somente
          administradores podem gerenciar mesas.
        </p>
      </div>
    );
  }

  const serviceDeskGridColumns = serviceDeskColumns(openDetail);
  const screenConfigColumns = serviceDeskGridColumns.map((c) => {
    const colId = (c as { accessorKey?: string }).accessorKey ?? c.id ?? '';
    const label = typeof c.header === 'string' ? c.header : colId;
    const isVisible = screenConfig.grid.columnVisibility[colId] !== false;
    return { id: colId, label, isVisible };
  });

  const totalCount = serviceDesks?.length ?? 0;
  const activeDesk = serviceDesks?.find((desk) => desk.id === selectedDeskId) ?? null;
  const recordCountText =
    mode === 'form' && selectedDeskId
      ? `1 de ${totalCount}`
      : `${totalCount === 0 ? 0 : 1} - ${totalCount} de ${totalCount}`;

  return (
    <EzPageLayout
      header={
        <EzPageHeader
          title={mode === 'form' && activeDesk ? activeDesk.displayName || activeDesk.name : 'Mesa'}
          showBackButton={mode === 'form'}
          onBack={() => guard(backToList)}
        />
      }
    >
    <div className="space-y-4">
      {isLoading ? (
        <EzSpinner label="Carregando…" />
      ) : (
        <div className="bg-white rounded-[10px] border border-gray-200 overflow-hidden shadow-xs flex flex-col">
          <EzEntityToolbar
            viewMode={mode === 'list' ? 'GRID' : 'FORM'}
            onToggleViewMode={(nextMode) =>
              guard(() => {
                if (nextMode === 'FORM') {
                  const active = selectedDesks[0] ?? serviceDesks?.[0];
                  if (active) {
                    openDetail(active.id);
                  } else {
                    handleInsert();
                  }
                } else {
                  backToList();
                }
              })
            }
            onInsert={() => guard(handleInsert)}
            insertAriaLabel="Nova Mesa"
            insertTooltip="Nova Mesa"
            isFilterOpen={isFilterPanelOpen}
            onToggleFilter={() => setIsFilterPanelOpen((prev) => !prev)}
            selectedCount={selectedDesks.length}
            onDelete={handleDelete}
            onClone={() => guard(handleClone)}
            onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['service-desks'] })}
            onOpenGridConfig={() => setIsScreenConfigModalOpen(true)}
            onOpenScreenConfig={() => setIsScreenConfigModalOpen(true)}
            recordCountText={recordCountText}
          />

          {mode === 'form' && (
            <div className="p-4 md:p-6">
              {selectedDeskId === null ? (
                <form
                  onSubmit={handleSubmit((values) => createMutation.mutate(values))}
                  noValidate
                  className="mx-auto max-w-xl space-y-4"
                >
                  <p className="text-sm text-gray-500">
                    Cadastre a mesa com o nome interno e, se quiser, um nome de exibição para o cliente.
                  </p>
                  <EzCardItem flat className="space-y-4 p-5">
                    <EzTextInput
                      id="service-desk-name"
                      label="Nome"
                      required
                      hasError={!!errors.name}
                      message={errors.name?.message}
                      {...register('name')}
                    />
                    <EzTextInput
                      id="service-desk-display-name"
                      label="Nome de exibição"
                      {...register('displayName')}
                    />
                    <EzTextArea
                      id="service-desk-description"
                      label="Descrição"
                      rows={3}
                      {...register('description')}
                    />
                    <div className="flex justify-end">
                      <EzButton type="submit" disabled={createMutation.isPending}>
                        Criar
                      </EzButton>
                    </div>
                  </EzCardItem>
                  {createMutation.isError && (
                    <EzAlert variant="error">Falha ao criar a mesa. Tente novamente.</EzAlert>
                  )}
                </form>
              ) : activeDesk ? (
                <div className="space-y-4">
                  <EzTabs
                    variant="pills"
                    tabs={mesaTabs}
                    activeTab={activeTab}
                    onChange={(tabId) => {
                      if (String(tabId) !== activeTab) guard(() => setActiveTab(String(tabId)));
                    }}
                    idPrefix={MESA_TABS_ID}
                  />
                  <div aria-live="polite">
                    {hasPending && (
                      <p className="flex items-center gap-2 text-sm text-gray-700">
                        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-600" />
                        Alterações não salvas nesta aba.
                      </p>
                    )}
                  </div>
                  <EzCardItem
                    flat
                    className="p-5 md:p-6"
                    role="tabpanel"
                    id={ezTabPanelId(MESA_TABS_ID, activeTab)}
                    aria-labelledby={ezTabId(MESA_TABS_ID, activeTab)}
                  >
                    {activeTab === 'basics' && (
                      <div className="space-y-6">
                        <MesaBasicsForm desk={activeDesk} />
                        <MesaFlagEditor
                          deskId={activeDesk.id}
                          flags={[
                            { key: 'active', label: 'Ativa' },
                            { key: 'acceptingNewTickets', label: 'Recebendo novos tickets' },
                            { key: 'internalUse', label: 'Uso interno' },
                            { key: 'worklogsWithValuation', label: 'Apontamentos com valorização' },
                          ]}
                          values={activeDesk}
                        />
                      </div>
                    )}
                    {activeTab === 'clients' && (
                      <ServiceDeskSlaEditor
                        deskId={activeDesk.id}
                        initial={{
                          organizations: activeDesk.organizations ?? [],
                          slaCriticalResponseHours: activeDesk.slaCriticalResponseHours,
                          slaCriticalResolveHours: activeDesk.slaCriticalResolveHours,
                          slaHighResponseHours: activeDesk.slaHighResponseHours,
                          slaHighResolveHours: activeDesk.slaHighResolveHours,
                          slaMediumResponseHours: activeDesk.slaMediumResponseHours,
                          slaMediumResolveHours: activeDesk.slaMediumResolveHours,
                          slaLowResponseHours: activeDesk.slaLowResponseHours,
                          slaLowResolveHours: activeDesk.slaLowResolveHours,
                        }}
                      />
                    )}
                    {activeTab === 'groups' && (
                      <div className="space-y-6">
                        <MesaFlagEditor
                          deskId={activeDesk.id}
                          flags={[
                            { key: 'listedGroupsOnly', label: 'Somente grupos listados' },
                            { key: 'unlistedCanCreateTicket', label: 'Não listados podem criar ticket' },
                          ]}
                          values={activeDesk}
                        />
                        <ServiceDeskEditor desk={activeDesk} agents={agents ?? []} />
                      </div>
                    )}
                    {activeTab === 'hours' && (
                      <BusinessHoursEditor serviceDeskId={activeDesk.id} />
                    )}
                    {activeTab === 'params' && (
                      <MesaFlagEditor
                        deskId={activeDesk.id}
                        flags={[
                          { key: 'allowCrossDeskInteraction', label: 'Interação com outras mesas', group: 'Geral' },
                          { key: 'allowCancelTicket', label: 'Permitir cancelar ticket', group: 'Geral' },
                          { key: 'catalogRequiredOnOpen', label: "Mostrar o catálogo ao abrir (permite 'não catalogado')", group: 'Geral' },
                          { key: 'openByAgentsOnly', label: 'Abertura só por atendentes', group: 'Geral' },
                          { key: 'slaControlEnabled', label: 'Controle de SLA', group: 'SLA' },
                          { key: 'allowAddSlaHours', label: 'Permitir adicionar horas ao SLA', group: 'SLA' },
                          { key: 'allowPauseResumeSla', label: 'Permitir parar e retomar o SLA', group: 'SLA' },
                          { key: 'reviewFlowEnabled', label: 'Fluxo de revisão', group: 'Revisão e avaliação' },
                          { key: 'evaluationEnabled', label: 'Avaliação', group: 'Revisão e avaliação' },
                        ]}
                        values={activeDesk}
                      />
                    )}
                    {activeTab === 'required' && (
                      <MesaFlagEditor
                        deskId={activeDesk.id}
                        flags={[
                          { key: 'requireRequesterName', label: 'Nome do solicitante' },
                          { key: 'requireRequesterEmail', label: 'E-mail do solicitante' },
                          { key: 'requireRequesterPhone', label: 'Telefone do solicitante' },
                          { key: 'requireRequesterExtension', label: 'Ramal do solicitante' },
                          { key: 'requireResourceGroup', label: 'Grupo de recurso' },
                          { key: 'requireAttachments', label: 'Anexos' },
                        ]}
                        values={activeDesk}
                      />
                    )}
                    {activeTab === 'reopen' && (
                      <MesaFlagEditor
                        deskId={activeDesk.id}
                        flags={[
                          { key: 'allowReopenUnbilled', label: 'Permitir reabrir não faturados' },
                          { key: 'allowReopenBilled', label: 'Permitir reabrir faturados' },
                        ]}
                        values={activeDesk}
                      />
                    )}
                    {activeTab === 'priorities' &&
                      ((activeDesk.priorities ?? []).length === 0 ? (
                        <p className="text-sm text-gray-500">
                          Prioridades padrão são criadas ao cadastrar a mesa.
                        </p>
                      ) : (
                        <MesaFlagEditor
                          deskId={activeDesk.id}
                          flags={(activeDesk.priorities ?? []).map((priority) => ({
                            key: priority.ticketPriority,
                            label: priority.label,
                          }))}
                          values={Object.fromEntries(
                            (activeDesk.priorities ?? []).map((priority) => [priority.ticketPriority, priority.enabled]),
                          )}
                          buildPayload={(draft) => ({
                            priorities: (activeDesk.priorities ?? []).map((priority) => ({
                              ticketPriority: priority.ticketPriority,
                              enabled: draft[priority.ticketPriority],
                            })),
                          })}
                        />
                      ))}
                    {activeTab === 'sections' &&
                      ((activeDesk.ticketSections ?? []).length === 0 ? (
                        <p className="text-sm text-gray-500">
                          Seções padrão são criadas ao cadastrar a mesa.
                        </p>
                      ) : (
                        <MesaFlagEditor
                          deskId={activeDesk.id}
                          flags={(activeDesk.ticketSections ?? []).map((section) => ({
                            key: section.key,
                            label: ticketSectionLabel(section.key),
                          }))}
                          values={Object.fromEntries(
                            (activeDesk.ticketSections ?? []).map((section) => [section.key, section.enabled]),
                          )}
                          buildPayload={(draft) => ({
                            ticketSections: (activeDesk.ticketSections ?? []).map((section) => ({
                              key: section.key,
                              enabled: draft[section.key],
                            })),
                          })}
                        />
                      ))}
                    {activeTab === 'stages' && (
                      <MesaStagesEditor deskId={activeDesk.id} />
                    )}
                    {activeTab === 'status' && <MesaStatusForm desk={activeDesk} />}
                    {activeTab === 'review' && (
                      <MesaFlagEditor
                        deskId={activeDesk.id}
                        flags={[
                          { key: 'reviewNotifyEmail', label: 'Notificar revisão por e-mail' },
                          { key: 'reviewReminder', label: 'Lembrete de revisão' },
                          { key: 'reviewReapplyReopen', label: 'Reaplicar revisão na reabertura' },
                        ]}
                        values={activeDesk}
                      />
                    )}
                  </EzCardItem>
                </div>
              ) : null}
            </div>
          )}

          {mode === 'list' && (
            <div className="relative flex flex-1 overflow-hidden min-h-[420px]">
              {/* Painel lateral de Filtros (Sankhya parity), mesmo padrão de OrganizationsPage.tsx */}
              <EzFilterDrawer
                isOpen={isFilterPanelOpen}
                onClose={() => setIsFilterPanelOpen(false)}
                onClear={() => {
                  setFilterSearch('');
                  setFilterStatus('ALL');
                  setDynamicRules([]);
                  setActiveSavedFilterId(null);
                }}
                title="Filtros de Mesas"
                savedFilters={screenConfig.savedFilters}
                activeSavedFilterId={activeSavedFilterId}
                onApplySavedFilter={(sf) => {
                  setActiveSavedFilterId(sf.id);
                  if (sf.criteria.search !== undefined) setFilterSearch(sf.criteria.search);
                  if (sf.criteria.status !== undefined) setFilterStatus(sf.criteria.status);
                  setDynamicRules(Array.isArray(sf.criteria.rules) ? sf.criteria.rules : []);
                }}
                onSaveCurrentFilter={(name) => {
                  saveFilter(name, {
                    search: filterSearch,
                    status: filterStatus,
                    rules: dynamicRules,
                  });
                }}
                onDeleteSavedFilter={(id) => {
                  deleteFilter(id);
                  if (activeSavedFilterId === id) setActiveSavedFilterId(null);
                }}
              >
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="filter-search-input" className="text-xs font-medium text-gray-700">
                      Buscar Mesa
                    </label>
                    <EzTextInput
                      id="filter-search-input"
                      placeholder="Nome, Nome de exibição…"
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="filter-status-select" className="text-xs font-medium text-gray-700">
                      Status
                    </label>
                    <EzComboBox
                      id="filter-status-select"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value as any)}
                    >
                      <option value="ALL">Todos os status</option>
                      <option value="ACTIVE">Apenas Ativos</option>
                      <option value="INACTIVE">Apenas Inativos</option>
                    </EzComboBox>
                  </div>

                  <EzDynamicFilter
                    fields={SERVICE_DESK_FILTER_FIELDS}
                    rules={dynamicRules}
                    onChange={setDynamicRules}
                  />
                </div>
              </EzFilterDrawer>

              {/* Grid Content */}
              <div data-testid="service-desks-grid-content"
className="isolate flex-1 p-3 overflow-x-auto touch-pan-x touch-pan-y overscroll-x-contain min-w-0 flex flex-col">
                {filteredDesks.length === 0 ? (
                  <div className="p-4">
                    <EzEmptyCard title="Nenhuma mesa cadastrada ainda." />
                  </div>
                ) : (
                  <EzEntityGrid
                    data={filteredDesks}
                    columns={serviceDeskGridColumns}
                    selectable
                    showRowNumbers
                    enableColumnMenu
                    enableColumnFilters
                    zebraStriping
                    density={screenConfig.grid.density}
                    initialColumnVisibility={screenConfig.grid.columnVisibility}
                    onSelectionChange={setSelectedDesks}
                    pageSize={10}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <EzDialog
        open={discardAction !== null}
        variant="warning"
        title="Descartar alterações?"
        message="As alterações não salvas desta aba serão perdidas."
        onCancel={() => setDiscardAction(null)}
        onConfirm={() => {
          const action = discardAction;
          setDiscardAction(null);
          action?.();
        }}
      />

      {isScreenConfigModalOpen && (
        <EzEntityScreenConfigModal
          columns={screenConfigColumns}
          onToggleColumn={(colId) => {
            setColumnVisibility((prev) => ({
              ...prev,
              [colId]: prev[colId] === false ? true : false,
            }));
          }}
          density={screenConfig.grid.density}
          onDensityChange={setDensity}
          formLayout={screenConfig.form.layout}
          onFormLayoutChange={setFormLayout}
          onRestoreDefaults={restoreDefaults}
          onClose={() => setIsScreenConfigModalOpen(false)}
          initialTab="grid"
        />
      )}
    </div>
    </EzPageLayout>
  );
}

export function ServiceDesksPage() {
  return (
    <MesaSaveProvider>
      <ServiceDesksPageContent />
    </MesaSaveProvider>
  );
}

export default ServiceDesksPage;
