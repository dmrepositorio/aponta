import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { ActiveTag } from '../components/ActiveTag';
import { MesaSaveProvider, useMesaPending } from '../components/mesaSave';
import { ROLE_LABELS, UserForm } from '../components/users/UserForm';
import {
  EzAlert,
  EzButton,
  EzCheck,
  EzComboBox,
  EzDialog,
  EzDynamicFilter,
  EzEmptyCard,
  EzEntityGrid,
  EzEntityScreenConfigModal,
  EzEntityToolbar,
  EzFilterDrawer,
  EzPageHeader,
  EzPageLayout,
  EzPagination,
  EzSpinner,
  EzTag,
  EzTextInput,
} from '../components/ds';
import { applyDynamicFilters } from '../components/ds/EzDynamicFilter';
import type { EzDynamicFilterField, EzDynamicFilterRule } from '../components/ds/EzDynamicFilter';
import { useHasPermission } from '../hooks/usePermissions';
import { usePermissionGroups } from '../hooks/usePermissionGroups';
import { useTechnicalGroups } from '../hooks/useTechnicalGroups';
import { useUserScreenConfig } from '../hooks/useUserScreenConfig';
import {
  UserListItem,
  apiErrorMessage,
  useSetUsersActive,
  useUser,
  useUsersList,
  UsersListParams,
} from '../hooks/useUsers';

const PAGE_SIZE = 20;

type StatusFilter = 'ALL' | NonNullable<UsersListParams['status']>;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Todos os status' },
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'INACTIVE', label: 'Inativo' },
  { value: 'PENDING', label: 'Convite pendente' },
];

/** Estado do painel de filtros: tudo menos `rules` vai ao servidor; `rules` filtra só a página carregada. */
interface Filters {
  search: string;
  roles: string[];
  status: StatusFilter;
  technicalGroupId: string;
  permissionGroupId: string;
  rules: EzDynamicFilterRule[];
}

const NO_FILTERS: Filters = {
  search: '',
  roles: [],
  status: 'ALL',
  technicalGroupId: '',
  permissionGroupId: '',
  rules: [],
};

const FILTER_FIELDS: EzDynamicFilterField[] = [
  { id: 'name', label: 'Nome', getValue: (u: UserListItem) => u.name },
  { id: 'email', label: 'E-mail', getValue: (u: UserListItem) => u.email },
  { id: 'technicalGroup', label: 'Grupo de atendentes', getValue: (u: UserListItem) => u.technicalGroup?.name },
];

const statusOf = (u: UserListItem) => (!u.active ? 'Inativo' : u.pending ? 'Convite pendente' : 'Ativo');

function userColumns(onOpen: (id: string) => void): ColumnDef<UserListItem>[] {
  return [
    {
      id: 'name',
      header: 'Nome',
      size: 170,
      meta: { truncate: true },
      accessorFn: (u) => u.name,
      cell: ({ row }) => (
        <div className="min-w-0 max-w-[170px]">
          <button
            type="button"
            title={row.original.name}
            onClick={() => onOpen(row.original.id)}
            className="block max-w-full truncate text-left font-medium text-brand-700 hover:underline cursor-pointer"
          >
            {row.original.name}
          </button>
          <div className="truncate text-xs text-gray-500" title={row.original.email}>{row.original.email}</div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      size: 144,
      accessorFn: statusOf,
      cell: ({ row }) => <ActiveTag active={row.original.active} pending={row.original.pending} />,
    },
    {
      id: 'permissionGroups',
      header: 'Grupos de permissões',
      size: 220,
      meta: { hideBelowSm: true },
      accessorFn: (u) => u.permissionGroups.map((g) => g.name).join(', '),
      cell: ({ row }) =>
        row.original.permissionGroups.length === 0 ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.original.permissionGroups.map((g) => (
              <EzTag key={g.id} label={g.name} />
            ))}
          </div>
        ),
    },
    {
      id: 'technicalGroup',
      header: 'Grupo de atendentes',
      size: 180,
      meta: { hideBelowSm: true },
      accessorFn: (u) => u.technicalGroup?.name ?? '',
      cell: ({ row }) =>
        row.original.technicalGroup ? (
          <EzTag label={row.original.technicalGroup.name} variant="petroleum" />
        ) : (
          <span className="text-xs text-gray-500">—</span>
        ),
    },
    {
      id: 'role',
      header: 'Tipo',
      size: 170,
      meta: { hideBelowSm: true },
      accessorFn: (u) => ROLE_LABELS[u.role] ?? u.role,
    },
  ];
}

function UserDetail({ userId }: { userId: string }) {
  const { data: user, isError } = useUser(userId);
  if (isError) return <EzEmptyCard title="Erro ao carregar usuário." />;
  if (!user) return <EzSpinner label="Carregando usuário…" />;
  return <UserForm key={user.id} user={user} />;
}

/**
 * Usuários no padrão dsgrid de Mesa e Clientes (DMTE-550): toolbar do DS, painel de filtros, colunas por
 * usuário, modo Grade/Formulário e o modelo de salvamento da Mesa. Filtros e paginação não vão para a URL,
 * como no dsgrid.
 */
function UsersPageContent() {
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('CREATE_USERS');
  const canToggleActive = useHasPermission('ACTIVATE_DEACTIVATE_USERS');

  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [activeSavedFilterId, setActiveSavedFilterId] = useState<string | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Alteração não salva pede confirmação antes de sair do formulário.
  const hasPending = useMesaPending();
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const guard = (action: () => void) => (hasPending ? setDiscardAction(() => action) : action());

  const { config, setColumnVisibility, setDensity, setFormLayout, saveFilter, deleteFilter, restoreDefaults } =
    useUserScreenConfig('users', {
      grid: { columnVisibility: {}, density: 'compact' },
      form: { layout: 'CASCADE' },
      viewMode: 'GRID',
    });

  const params: UsersListParams = {
    q: filters.search.trim() || undefined,
    technicalGroupId: filters.technicalGroupId || undefined,
    permissionGroupId: filters.permissionGroupId || undefined,
    roles: filters.roles.length > 0 ? filters.roles.join(',') : undefined,
    status: filters.status === 'ALL' ? undefined : filters.status,
    page,
    pageSize: PAGE_SIZE,
  };
  const { data, isLoading, isError } = useUsersList(params);
  const { data: technicalGroups } = useTechnicalGroups();
  const { data: permissionGroups } = usePermissionGroups();

  const meta = data?.meta;
  const users = useMemo(
    () => applyDynamicFilters(data?.data ?? [], filters.rules, FILTER_FIELDS),
    [data, filters.rules],
  );

  /** Mudar filtro ou busca volta à página 1. */
  const change = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
    setActiveSavedFilterId(null);
  };
  const toggleRole = (role: string) =>
    change({ roles: filters.roles.includes(role) ? filters.roles.filter((r) => r !== role) : [...filters.roles, role] });

  // Seleção da grade por posição de linha: a chave refaz a grade (e zera a seleção) quando os dados mudam de lugar.
  const [refresh, setRefresh] = useState(0);
  const gridKey = JSON.stringify([params, filters.rules, config.grid.columnVisibility, refresh]);
  const [selection, setSelection] = useState<{ key: string; rows: UserListItem[] }>({ key: '', rows: [] });
  const selected = selection.key === gridKey ? selection.rows : [];

  const [batch, setBatch] = useState<boolean | null>(null); // active a aplicar, quando há confirmação aberta
  const [batchError, setBatchError] = useState<string | null>(null);
  const setUsersActive = useSetUsersActive();
  const confirmBatch = () => {
    if (batch === null) return;
    const active = batch;
    setBatch(null);
    setBatchError(null);
    setUsersActive.mutate(
      { ids: selected.map((u) => u.id), active },
      { onSuccess: () => setRefresh((n) => n + 1), onError: (error) => setBatchError(apiErrorMessage(error)) },
    );
  };

  const openUser = (id: string) => {
    setSelectedUserId(id);
    setMode('form');
  };
  const startNew = () => {
    setSelectedUserId(null);
    setMode('form');
  };
  const backToList = () => {
    setMode('list');
    setSelectedUserId(null);
  };

  const columns = userColumns((id) => guard(() => openUser(id)));
  const screenColumns = columns.map((c) => ({
    id: c.id ?? '',
    label: typeof c.header === 'string' ? c.header : (c.id ?? ''),
    isVisible: config.grid.columnVisibility[c.id ?? ''] !== false,
  }));

  const total = meta?.total ?? 0;
  const first = (page - 1) * PAGE_SIZE;
  const recordCountText =
    mode === 'form' && selectedUserId
      ? `1 de ${total}`
      : `${users.length === 0 ? 0 : first + 1} - ${first + users.length} de ${total}`;

  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className="text-xs font-medium text-gray-700">
      {text}
    </label>
  );

  return (
    <EzPageLayout
      header={
        <EzPageHeader
          title={mode === 'form' && !selectedUserId ? 'Novo usuário' : 'Usuários'}
          showBackButton={mode === 'form'}
          onBack={() => guard(backToList)}
        />
      }
    >
      <div className="flex flex-col overflow-hidden rounded-[10px] border border-gray-200 bg-white shadow-xs">
        <EzEntityToolbar
          viewMode={mode === 'list' ? 'GRID' : 'FORM'}
          onToggleViewMode={(next) =>
            guard(() => {
              if (next === 'GRID') return backToList();
              const target = selected[0] ?? users[0];
              if (target) openUser(target.id);
              else if (canCreate) startNew();
            })
          }
          onInsert={canCreate ? () => guard(startNew) : undefined}
          insertAriaLabel="Novo usuário"
          insertTooltip="Novo usuário"
          isFilterOpen={isFilterOpen}
          onToggleFilter={mode === 'list' ? () => setIsFilterOpen((open) => !open) : undefined}
          onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['users'] })}
          onOpenGridConfig={() => setIsConfigOpen(true)}
          onOpenScreenConfig={() => setIsConfigOpen(true)}
          recordCountText={recordCountText}
        />

        {mode === 'form' && (
          <div className="p-4 md:p-6">
            {selectedUserId ? (
              <UserDetail key={selectedUserId} userId={selectedUserId} />
            ) : (
              <UserForm key="new" onCreated={(created) => setSelectedUserId(created.id)} />
            )}
          </div>
        )}

        {mode === 'list' && (
          <>
            {canToggleActive && (
              <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-1.5 max-sm:hidden">
                <EzButton
                  type="button"
                  variant="secondary"
                  size="small"
                  label="Ativar"
                  disabled={selected.length === 0 || setUsersActive.isPending}
                  onClick={() => setBatch(true)}
                />
                <EzButton
                  type="button"
                  variant="secondary"
                  size="small"
                  label="Inativar"
                  disabled={selected.length === 0 || setUsersActive.isPending}
                  onClick={() => setBatch(false)}
                />
                <span aria-live="polite" className="text-xs text-gray-600">
                  {selected.length === 0 ? 'Marque usuários na grade para ativar ou inativar.' : `${selected.length} selecionado(s)`}
                </span>
              </div>
            )}
            {batchError && (
              <div className="p-3">
                <EzAlert variant="error">{batchError}</EzAlert>
              </div>
            )}

            <div className="relative flex min-h-[420px] flex-1 overflow-hidden">
              <EzFilterDrawer
                isOpen={isFilterOpen}
                onClose={() => setIsFilterOpen(false)}
                onClear={() => {
                  change(NO_FILTERS);
                }}
                title="Filtros de Usuários"
                savedFilters={config.savedFilters}
                activeSavedFilterId={activeSavedFilterId}
                onApplySavedFilter={(saved) => {
                  setFilters({ ...NO_FILTERS, ...saved.criteria });
                  setPage(1);
                  setActiveSavedFilterId(saved.id);
                }}
                onSaveCurrentFilter={(name) => saveFilter(name, filters)}
                onDeleteSavedFilter={(id) => {
                  deleteFilter(id);
                  if (activeSavedFilterId === id) setActiveSavedFilterId(null);
                }}
              >
                <div className="space-y-4">
                  <EzTextInput
                    id="filter-search-input"
                    label="Buscar usuário"
                    placeholder="Nome ou e-mail…"
                    value={filters.search}
                    onChange={(e) => change({ search: e.target.value })}
                  />

                  <fieldset className="space-y-1.5">
                    <legend className="mb-1 text-xs font-medium text-gray-700">Tipo</legend>
                    {Object.entries(ROLE_LABELS).map(([role, text]) => (
                      <div key={role}>
                        <EzCheck
                          id={`filter-role-${role}`}
                          label={text}
                          checked={filters.roles.includes(role)}
                          onChange={() => toggleRole(role)}
                        />
                      </div>
                    ))}
                  </fieldset>

                  <div className="space-y-1.5">
                    {label('filter-status-select', 'Status')}
                    <EzComboBox
                      id="filter-status-select"
                      value={filters.status}
                      onChange={(e) => change({ status: e.target.value as StatusFilter })}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </EzComboBox>
                  </div>

                  <div className="space-y-1.5">
                    {label('filter-technical-group', 'Grupo de atendentes')}
                    <EzComboBox
                      id="filter-technical-group"
                      value={filters.technicalGroupId}
                      onChange={(e) => change({ technicalGroupId: e.target.value })}
                    >
                      <option value="">Todos os grupos</option>
                      {(technicalGroups ?? []).map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </EzComboBox>
                  </div>

                  <div className="space-y-1.5">
                    {label('filter-permission-group', 'Grupo de permissões')}
                    <EzComboBox
                      id="filter-permission-group"
                      value={filters.permissionGroupId}
                      onChange={(e) => change({ permissionGroupId: e.target.value })}
                    >
                      <option value="">Todos os grupos</option>
                      {(permissionGroups ?? []).map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </EzComboBox>
                  </div>

                  {/* shortcut: filtros dinâmicos valem só para a página carregada; os de cima vão ao servidor. */}
                  <EzDynamicFilter fields={FILTER_FIELDS} rules={filters.rules} onChange={(rules) => change({ rules })} />
                </div>
              </EzFilterDrawer>

              <div
                data-testid="users-grid-content"
                className="isolate flex min-w-0 flex-1 touch-pan-x touch-pan-y flex-col overflow-x-auto overscroll-x-contain p-3"
              >
                {isLoading ? (
                  <div className="p-8">
                    <EzSpinner label="Carregando usuários…" />
                  </div>
                ) : isError ? (
                  <div className="p-4">
                    <EzEmptyCard title="Erro ao carregar usuários." />
                  </div>
                ) : users.length === 0 ? (
                  <div className="p-4">
                    <EzEmptyCard title="Nenhum usuário encontrado." />
                  </div>
                ) : (
                  <EzEntityGrid
                    key={gridKey}
                    data={users}
                    columns={columns}
                    selectable
                    showRowNumbers
                    compactBelowSm
                    enableColumnGrouping={false}
                    enableColumnMenu
                    enableColumnFilters
                    zebraStriping
                    showStatusBar={false}
                    density={config.grid.density}
                    initialColumnVisibility={config.grid.columnVisibility}
                    onSelectionChange={(rows) => setSelection({ key: gridKey, rows })}
                  />
                )}
                {meta && meta.totalPages > 1 && (
                  <div className="px-1 pt-3">
                    <EzPagination currentPage={page} totalPages={meta.totalPages} onChange={setPage} />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <EzDialog
        open={discardAction !== null}
        variant="warning"
        title="Descartar alterações?"
        message="As alterações não salvas deste usuário serão perdidas."
        onCancel={() => setDiscardAction(null)}
        onConfirm={() => {
          const action = discardAction;
          setDiscardAction(null);
          action?.();
        }}
      />

      <EzDialog
        open={batch !== null}
        variant={batch ? 'info' : 'warning'}
        title={batch ? 'Ativar usuários?' : 'Inativar usuários?'}
        message={`${batch ? 'Ativar' : 'Inativar'} ${selected.length} ${selected.length === 1 ? 'usuário' : 'usuários'}. ${
          batch ? 'Eles voltam a poder acessar o Aponta.' : 'Eles perdem o acesso ao Aponta na hora.'
        }`}
        onCancel={() => setBatch(null)}
        onConfirm={confirmBatch}
      />

      {isConfigOpen && (
        <EzEntityScreenConfigModal
          columns={screenColumns}
          onToggleColumn={(id) => setColumnVisibility((prev) => ({ ...prev, [id]: prev[id] === false }))}
          density={config.grid.density}
          onDensityChange={setDensity}
          formLayout={config.form.layout}
          onFormLayoutChange={setFormLayout}
          onRestoreDefaults={restoreDefaults}
          onClose={() => setIsConfigOpen(false)}
          initialTab="grid"
        />
      )}
    </EzPageLayout>
  );
}

export function UsersPage() {
  return (
    <MesaSaveProvider>
      <UsersPageContent />
    </MesaSaveProvider>
  );
}

export default UsersPage;
