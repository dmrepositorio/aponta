import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, type UseMutationResult } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import {
  EzButton,
  EzCardItem,
  EzCheck,
  EzDialog,
  EzDoubleList,
  EzEmptyCard,
  EzListItem,
  EzModal,
  EzPageHeader,
  EzPageLayout,
  EzSpinner,
  EzTabs,
  EzTextArea,
  EzTextInput,
  EzToast,
} from '../components/ds';
import { api } from '../lib/api';
import { apiErrorMessage } from '../hooks/useUsers';
import {
  usePermissionGroups,
  usePermissionGroup,
  usePermissionCatalog,
  useCreatePermissionGroup,
  useUpdatePermissionGroup,
  useUpdatePermissionGroupPermissions,
  useDeletePermissionGroup,
  usePermissionGroupUserMutations,
  usePermissionGroupTechnicalGroupMutations,
} from '../hooks/usePermissionGroups';

type DetailTab = 'info' | 'permissions' | 'links';

type Notice = { variant: 'success' | 'error'; title: string };
type Notify = (variant: Notice['variant'], title: string) => void;

interface PendingRemoval {
  kind: 'user' | 'technical';
  id: string;
  name: string;
}

const TOAST_MS = 4000;
const ACTION_ERROR_FALLBACK = 'Não foi possível concluir a ação. Tente novamente.';
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

const CATEGORY_LABELS: Record<string, string> = {
  ADMINISTRATIVE: 'Permissões administrativas',
  CLIENT: 'Permissões de cliente',
  MANAGEMENT: 'Permissões de gestão',
  REPORTING: 'Permissões de relatório',
  TECHNICAL: 'Permissões técnicas',
};

interface SimpleUser {
  id: string;
  name: string;
  email: string;
}

interface SimpleRef {
  id: string;
  name: string;
}

const USER_SEARCH_DEBOUNCE_MS = 300;
const USER_SEARCH_PAGE_SIZE = 20;

// Primeira página de /users filtrada por `q` (nome ou e-mail). A chave é própria: ['users','all'] segue
// sendo a lista completa de outra tela.
function useUserSearch(term: string) {
  return useQuery({
    queryKey: ['users', 'search', term],
    queryFn: async () => {
      const { data } = await api.get<{ data: SimpleUser[] }>('/users', {
        params: { ...(term ? { q: term } : {}), page: 1, pageSize: USER_SEARCH_PAGE_SIZE },
      });
      return data.data;
    },
    placeholderData: keepPreviousData,
  });
}

function useAllTechnicalGroups() {
  return useQuery({
    queryKey: ['technical-groups'],
    queryFn: async () => {
      const { data } = await api.get<SimpleRef[]>('/technical-groups');
      return data;
    },
  });
}

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMutation = useCreatePermissionGroup();

  const handleSubmit = () => {
    if (!name.trim()) return;
    createMutation.mutate(
      { name: name.trim(), description: description.trim() || undefined },
      { onSuccess: onClose },
    );
  };

  return (
    <EzModal isOpen onClose={onClose} title="Novo grupo de permissões">
      <div className="space-y-4">
        <EzTextInput id="pg-name" label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <EzTextArea
          id="pg-description"
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <EzButton variant="tertiary" onClick={onClose}>
            Cancelar
          </EzButton>
          <EzButton onClick={handleSubmit} disabled={createMutation.isPending}>
            Criar
          </EzButton>
        </div>
      </div>
    </EzModal>
  );
}

function GroupDetail({
  groupId,
  onBack,
  onNotify,
  onDeleted,
  onDirtyChange,
}: {
  groupId: string;
  onBack: () => void;
  onNotify: Notify;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { data: group, isLoading } = usePermissionGroup(groupId);
  const { data: catalog } = usePermissionCatalog();
  const [tab, setTab] = useState<DetailTab>('info');
  const [pendingTab, setPendingTab] = useState<DetailTab | null>(null);
  const updateMutation = useUpdatePermissionGroup(groupId);
  const updatePermissionsMutation = useUpdatePermissionGroupPermissions(groupId);
  const deleteMutation = useDeletePermissionGroup();
  const { addUser, removeUser } = usePermissionGroupUserMutations(groupId);
  const { addTechnicalGroup, removeTechnicalGroup } = usePermissionGroupTechnicalGroupMutations(groupId);

  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedUserSearch(userSearch.trim()), USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [userSearch]);
  const { data: foundUsers, isError: isUserSearchError, isFetching: isUserSearchFetching } =
    useUserSearch(debouncedUserSearch);
  const userListStatus = isUserSearchError
    ? 'error'
    : isUserSearchFetching || userSearch.trim() !== debouncedUserSearch
      ? 'loading'
      : undefined;
  const { data: allTechnicalGroups } = useAllTechnicalGroups();

  const [confirmingSave, setConfirmingSave] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  // Rascunhos: só existem depois da primeira edição e voltam ao valor do servidor sempre que ele
  // muda (ex.: depois de Salvar ou de uma edição externa), em vez de nascerem no primeiro render.
  const [infoEdits, setInfoEdits] = useState<{ name: string; description: string } | null>(null);
  const [permissionEdits, setPermissionEdits] = useState<Set<string> | null>(null);

  const serverKeys = useMemo(() => new Set(group?.permissions ?? []), [group?.permissions]);
  const serverKeysSignature = [...serverKeys].sort().join('|');
  const infoDraft = infoEdits ?? (group ? { name: group.name, description: group.description ?? '' } : null);
  const selectedKeys = permissionEdits ?? serverKeys;
  const infoDirty =
    !!infoEdits && !!group && (infoEdits.name !== group.name || infoEdits.description !== (group.description ?? ''));
  const permissionsDirty = !!permissionEdits && !sameSet(permissionEdits, serverKeys);
  const dirty = infoDirty || permissionsDirty;

  useEffect(() => {
    setPermissionEdits(null);
  }, [groupId, serverKeysSignature]);

  useEffect(() => {
    setInfoEdits(null);
  }, [groupId, group?.name, group?.description]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const categories = useMemo(() => {
    const byCategory = new Map<string, { key: string; label: string }[]>();
    for (const entry of catalog ?? []) {
      const list = byCategory.get(entry.category) ?? [];
      list.push({ key: entry.key, label: entry.label });
      byCategory.set(entry.category, list);
    }
    return Array.from(byCategory.entries());
  }, [catalog]);

  // Roda a mutação e avisa o resultado por toast; cada chamada resolve a sua própria promessa.
  const run = <V,>(mutation: UseMutationResult<unknown, unknown, V>, variables: V, success: string) =>
    mutation.mutateAsync(variables).then(
      () => onNotify('success', success),
      (error: unknown) => onNotify('error', apiErrorMessage(error, ACTION_ERROR_FALLBACK)),
    );

  if (isLoading || !group || !infoDraft) {
    return (
      <div className="p-8">
        <EzSpinner label="Carregando grupo…" />
      </div>
    );
  }

  const toggleKey = (key: string, checked: boolean) => {
    setPermissionEdits(() => {
      const next = new Set(selectedKeys);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleCategory = (keys: string[], checked: boolean) => {
    setPermissionEdits(() => {
      const next = new Set(selectedKeys);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const tabDirty = tab === 'info' ? infoDirty : tab === 'permissions' ? permissionsDirty : false;
  const changeTab = (next: DetailTab) => {
    if (next === tab) return;
    if (tabDirty) setPendingTab(next);
    else setTab(next);
  };
  const confirmTabChange = () => {
    if (!pendingTab) return;
    setInfoEdits(null);
    setPermissionEdits(null);
    setTab(pendingTab);
    setPendingTab(null);
  };

  const labelOf = (key: string) => (catalog ?? []).find((entry) => entry.key === key)?.label ?? key;
  const addedKeys = [...selectedKeys].filter((key) => !serverKeys.has(key));
  const removedKeys = [...serverKeys].filter((key) => !selectedKeys.has(key));

  // O detalhe em cache pode ser parcial (a API do PATCH devolve só a linha do grupo).
  const userMembers = group.userMembers ?? [];
  const technicalGroupLinks = group.technicalGroupLinks ?? [];
  const userCount = userMembers.length;
  const technicalGroupCount = technicalGroupLinks.length;
  const affectedText =
    `${plural(userCount, 'usuário vinculado diretamente', 'usuários vinculados diretamente')} e ` +
    `${plural(technicalGroupCount, 'grupo de atendentes vinculado', 'grupos de atendentes vinculados')}`;

  const confirmSave = () => {
    void run(updatePermissionsMutation, Array.from(selectedKeys), 'Permissões salvas').finally(() =>
      setConfirmingSave(false),
    );
  };

  const confirmRemoval = () => {
    if (!pendingRemoval) return;
    const { kind, id } = pendingRemoval;
    const done = () => setPendingRemoval(null);
    if (kind === 'user') void run(removeUser, id, 'Usuário desvinculado').finally(done);
    else void run(removeTechnicalGroup, id, 'Grupo de atendentes desvinculado').finally(done);
  };
  const removalPending = removeUser.isPending || removeTechnicalGroup.isPending;

  const confirmDelete = () => {
    deleteMutation.mutateAsync(groupId).then(onDeleted, (error: unknown) => {
      setConfirmingDelete(false);
      onNotify('error', apiErrorMessage(error, ACTION_ERROR_FALLBACK));
    });
  };

  const linkedUserIds = new Set(userMembers.map((m) => m.user.id));
  const availableUsers = (foundUsers ?? []).filter((u) => !linkedUserIds.has(u.id));

  const linkedTechnicalGroupIds = new Set(technicalGroupLinks.map((l) => l.technicalGroup.id));
  const availableTechnicalGroups = (allTechnicalGroups ?? []).filter(
    (g) => !linkedTechnicalGroupIds.has(g.id),
  );

  return (
    <div className="space-y-5 p-5">
      <h2 className="text-[18px] font-semibold text-gray-900">{group.name}</h2>

      <EzTabs
        tabs={[
          { id: 'info', label: 'Informações' },
          { id: 'permissions', label: 'Permissões' },
          { id: 'links', label: 'Vínculos' },
        ]}
        activeTab={tab}
        onChange={(id) => changeTab(id as DetailTab)}
      />

      {tab === 'info' && (
        <div className="space-y-4">
          <EzTextInput
            id="pg-detail-name"
            label="Nome"
            value={infoDraft.name}
            onChange={(e) => setInfoEdits({ ...infoDraft, name: e.target.value })}
          />
          <EzTextArea
            id="pg-detail-description"
            label="Descrição"
            value={infoDraft.description}
            onChange={(e) => setInfoEdits({ ...infoDraft, description: e.target.value })}
          />
          <div className="flex items-center justify-end gap-3">
            {infoDirty && <span className="text-[12px] font-medium text-gray-600">Alterações não salvas</span>}
            <EzButton
              size="small"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate(infoDraft)}
            >
              Salvar
            </EzButton>
          </div>
        </div>
      )}

      {tab === 'permissions' && (
        <div className="space-y-6">
          {categories.map(([category, entries]) => {
            const categoryKeys = entries.map((e) => e.key);
            const allSelected = categoryKeys.every((key) => selectedKeys.has(key));
            return (
              <div key={category} className="space-y-2 rounded-[8px] border border-gray-200 p-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {CATEGORY_LABELS[category] ?? category}
                  </h3>
                  <EzCheck
                    id={`pg-select-all-${category}`}
                    label={`Selecionar todos (${CATEGORY_LABELS[category] ?? category})`}
                    checked={allSelected}
                    onChange={(e) => toggleCategory(categoryKeys, e.target.checked)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {entries.map((entry) => (
                    <EzCheck
                      key={entry.key}
                      id={`pg-permission-${entry.key}`}
                      label={entry.label}
                      checked={selectedKeys.has(entry.key)}
                      onChange={(e) => toggleKey(entry.key, e.target.checked)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-3">
            {permissionsDirty && (
              <span className="text-[12px] font-medium text-gray-600">Alterações não salvas</span>
            )}
            <EzButton disabled={!permissionsDirty} onClick={() => setConfirmingSave(true)}>
              Salvar permissões
            </EzButton>
          </div>
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Usuários vinculados diretamente</h3>
            <EzDoubleList
              availableLabel="Usuários disponíveis"
              selectedLabel="Vinculados"
              available={availableUsers.map((u) => ({ id: u.id, label: u.name, description: u.email }))}
              selected={userMembers.map((m) => ({
                id: m.user.id,
                label: m.user.name,
                description: m.user.email,
              }))}
              onAvailableSearch={setUserSearch}
              availableStatus={userListStatus}
              onAdd={(item) => void run(addUser, String(item.id), 'Usuário vinculado')}
              onRemove={(item) =>
                setPendingRemoval({ kind: 'user', id: String(item.id), name: String(item.label) })
              }
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Grupos de atendentes vinculados</h3>
            <EzDoubleList
              availableLabel="Grupos disponíveis"
              selectedLabel="Vinculados"
              available={availableTechnicalGroups.map((g) => ({ id: g.id, label: g.name }))}
              selected={technicalGroupLinks.map((l) => ({
                id: l.technicalGroup.id,
                label: l.technicalGroup.name,
              }))}
              onAdd={(item) => void run(addTechnicalGroup, String(item.id), 'Grupo de atendentes vinculado')}
              onRemove={(item) =>
                setPendingRemoval({
                  kind: 'technical',
                  id: String(item.id),
                  name: String(item.label),
                })
              }
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para a lista
        </button>
        <EzButton variant="danger" size="small" leftIcon={Trash2} onClick={() => setConfirmingDelete(true)}>
          Excluir grupo
        </EzButton>
      </div>

      <EzDialog
        open={confirmingSave}
        variant="warning"
        title="Salvar permissões"
        message={`A nova seleção passa a valer para todos os membros do grupo "${group.name}".`}
        confirmLoading={updatePermissionsMutation.isPending}
        onConfirm={confirmSave}
        onCancel={() => {
          if (!updatePermissionsMutation.isPending) setConfirmingSave(false);
        }}
      >
        <div className="mt-3 space-y-2">
          <p className="font-semibold text-gray-900">
            +{addedKeys.length} / -{removedKeys.length} permissões
          </p>
          {addedKeys.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-gray-600">Adicionadas</p>
              <ul className="list-disc pl-5">
                {addedKeys.map((key) => (
                  <li key={key}>{labelOf(key)}</li>
                ))}
              </ul>
            </div>
          )}
          {removedKeys.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-gray-600">Removidas</p>
              <ul className="list-disc pl-5">
                {removedKeys.map((key) => (
                  <li key={key}>{labelOf(key)}</li>
                ))}
              </ul>
            </div>
          )}
          <p>Afeta {affectedText}.</p>
          {technicalGroupCount > 0 && (
            <p className="text-[12px] text-gray-600">
              Os membros dos grupos de atendentes vinculados também são afetados e não entram na contagem de
              usuários.
            </p>
          )}
        </div>
      </EzDialog>

      <EzDialog
        open={pendingRemoval !== null}
        variant="danger"
        title={pendingRemoval?.kind === 'user' ? 'Remover usuário do grupo' : 'Remover grupo de atendentes'}
        message={
          pendingRemoval
            ? `Remover "${pendingRemoval.name}" do grupo "${group.name}"? ` +
              (pendingRemoval.kind === 'user'
                ? 'O usuário perde as permissões concedidas por este grupo, a menos que as receba por outro vínculo.'
                : 'Os membros desse grupo de atendentes perdem as permissões concedidas por este grupo, a menos que as recebam por outro vínculo.')
            : ''
        }
        confirmLabel="Remover"
        confirmLoading={removalPending}
        onConfirm={confirmRemoval}
        onCancel={() => {
          if (!removalPending) setPendingRemoval(null);
        }}
      />

      <EzDialog
        open={confirmingDelete}
        variant="danger"
        title="Excluir grupo"
        message={`O grupo "${group.name}" tem ${affectedText}. Todos perdem as permissões concedidas por ele. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        confirmLoading={deleteMutation.isPending}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleteMutation.isPending) setConfirmingDelete(false);
        }}
      />

      <EzDialog
        open={pendingTab !== null}
        variant="warning"
        title="Descartar alterações?"
        message="As alterações não salvas desta aba serão perdidas."
        onCancel={() => setPendingTab(null)}
        onConfirm={confirmTabChange}
      />
    </div>
  );
}

export function PermissionGroupsPage() {
  const { data: groups, isLoading } = usePermissionGroups();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [detailDirty, setDetailDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const notify: Notify = (variant, title) => setNotice({ variant, title });
  const leaveDetail = () => {
    setDiscardOpen(false);
    setDetailDirty(false);
    setSelectedGroupId(null);
  };
  const requestBack = () => (detailDirty ? setDiscardOpen(true) : leaveDetail());

  // Sucesso some sozinho; erro fica até ser fechado.
  useEffect(() => {
    if (notice?.variant !== 'success') return;
    const timer = setTimeout(() => setNotice(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <EzPageLayout
      header={
        <EzPageHeader
          title="Grupos de permissões"
          showBackButton={!!selectedGroupId}
          onBack={requestBack}
        />
      }
    >
      {selectedGroupId ? (
        <EzCardItem flat className="p-0">
          <GroupDetail
            groupId={selectedGroupId}
            onBack={requestBack}
            onNotify={notify}
            onDeleted={() => {
              notify('success', 'Grupo excluído');
              leaveDetail();
            }}
            onDirtyChange={setDetailDirty}
          />
        </EzCardItem>
      ) : (
        <EzCardItem flat className="overflow-hidden p-0">
          <div className="flex items-center justify-end gap-3 border-b border-gray-100 px-4 py-3">
            <EzButton size="small" leftIcon={Plus} onClick={() => setIsCreateOpen(true)}>
              Novo grupo
            </EzButton>
          </div>

          {isLoading ? (
            <div className="p-8">
              <EzSpinner label="Carregando grupos…" />
            </div>
          ) : !groups || groups.length === 0 ? (
            <EzEmptyCard title="Nenhum grupo de permissões cadastrado." />
          ) : (
            <div className="divide-y divide-gray-100 p-2">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className="block w-full text-left"
                >
                  <EzListItem description={group.description ?? undefined} className="rounded-[8px]">
                    {group.name}
                  </EzListItem>
                </button>
              ))}
            </div>
          )}
        </EzCardItem>
      )}

      <EzDialog
        open={discardOpen}
        variant="warning"
        title="Descartar alterações?"
        message="As alterações não salvas deste grupo serão perdidas."
        onCancel={() => setDiscardOpen(false)}
        onConfirm={leaveDetail}
      />

      {isCreateOpen && <CreateGroupModal onClose={() => setIsCreateOpen(false)} />}

      {notice && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 w-[calc(100%-2rem)] max-w-sm">
          <EzToast variant={notice.variant} title={notice.title} onClose={() => setNotice(null)} />
        </div>
      )}
    </EzPageLayout>
  );
}

export default PermissionGroupsPage;
