import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, type UseMutationResult } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  EzAlert,
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
  useTechnicalGroups,
  useTechnicalGroup,
  useCreateTechnicalGroup,
  useUpdateTechnicalGroup,
  useTechnicalGroupMemberMutations,
  useTechnicalGroupOrganizationMutations,
  useTechnicalGroupServiceDeskMutations,
} from '../hooks/useTechnicalGroups';

type DetailTab = 'info' | 'team' | 'access';

interface InfoDraft {
  name: string;
  description: string;
  dailyWorklogEmailEnabled: boolean;
  scheduleEnabled: boolean;
}

const sameInfo = (a: InfoDraft, b: InfoDraft) =>
  a.name === b.name &&
  a.description === b.description &&
  a.dailyWorklogEmailEnabled === b.dailyWorklogEmailEnabled &&
  a.scheduleEnabled === b.scheduleEnabled;

const TOAST_MS = 4000;
const ACTION_ERROR_FALLBACK = 'Não foi possível concluir a ação. Tente novamente.';

interface SimpleUser {
  id: string;
  name: string;
  email: string;
}

interface SimpleRef {
  id: string;
  name: string;
}

function useAllUsers() {
  return useQuery({
    queryKey: ['users', 'all'],
    queryFn: async () => {
      const { data } = await api.get<SimpleUser[]>('/users');
      return data;
    },
  });
}

function useAllOrganizations() {
  return useQuery({
    queryKey: ['organizations', 'all'],
    queryFn: async () => {
      const { data } = await api.get<SimpleRef[]>('/organizations');
      return data;
    },
  });
}

function useAllServiceDesks() {
  return useQuery({
    queryKey: ['service-desks', 'all'],
    queryFn: async () => {
      const { data } = await api.get<SimpleRef[]>('/service-desks');
      return data;
    },
  });
}

function CreateGroupModal({ onClose, onNotify }: { onClose: () => void; onNotify: (message: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const createMutation = useCreateTechnicalGroup();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (createMutation.isPending) return;
    if (!name.trim()) {
      setNameError('Informe o nome');
      return;
    }
    createMutation.mutate(
      { name: name.trim(), description: description.trim() || undefined },
      {
        onSuccess: () => {
          onNotify('Grupo criado');
          onClose();
        },
      },
    );
  };

  return (
    <EzModal isOpen onClose={onClose} title="Novo grupo de atendentes">
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {createMutation.isError && (
          <EzAlert variant="error">{apiErrorMessage(createMutation.error, ACTION_ERROR_FALLBACK)}</EzAlert>
        )}
        <EzTextInput
          id="tg-name"
          label="Nome"
          required
          autoFocus
          value={name}
          hasError={!!nameError}
          message={nameError}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(undefined);
          }}
        />
        <EzTextArea
          id="tg-description"
          label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <EzButton variant="tertiary" onClick={onClose}>
            Cancelar
          </EzButton>
          <EzButton type="submit" loading={createMutation.isPending}>
            Criar
          </EzButton>
        </div>
      </form>
    </EzModal>
  );
}

function GroupDetail({
  groupId,
  onBack,
  onNotify,
  onDirtyChange,
}: {
  groupId: string;
  onBack: () => void;
  onNotify: (message: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { data: group, isLoading } = useTechnicalGroup(groupId);
  const [tab, setTab] = useState<DetailTab>('info');
  const updateMutation = useUpdateTechnicalGroup(groupId);
  const { addMember, removeMember } = useTechnicalGroupMemberMutations(groupId);
  const { addOrganization, removeOrganization } = useTechnicalGroupOrganizationMutations(groupId);
  const { addServiceDesk, removeServiceDesk } = useTechnicalGroupServiceDeskMutations(groupId);

  const { data: allUsers } = useAllUsers();
  const { data: allOrganizations } = useAllOrganizations();
  const { data: allServiceDesks } = useAllServiceDesks();

  const [actionError, setActionError] = useState<string | null>(null);
  // Roda a mutação e mostra o resultado: toast de sucesso, ou o erro da API no alerta da seção.
  const run = <V,>(mutation: UseMutationResult<unknown, unknown, V>, variables: V, success: string) => {
    setActionError(null);
    mutation.mutate(variables, {
      onSuccess: () => onNotify(success),
      onError: (error) => setActionError(apiErrorMessage(error, ACTION_ERROR_FALLBACK)),
    });
  };

  // Rascunho único da aba Informações: só existe depois da primeira edição e volta ao valor do
  // servidor sempre que um dos quatro campos muda lá (ex.: depois de Salvar ou edição externa).
  const [edits, setEdits] = useState<InfoDraft | null>(null);
  const serverInfo: InfoDraft | null = group
    ? {
        name: group.name,
        description: group.description ?? '',
        dailyWorklogEmailEnabled: group.dailyWorklogEmailEnabled,
        scheduleEnabled: group.scheduleEnabled,
      }
    : null;
  const draft = edits ?? serverInfo;
  const dirty = !!edits && !!serverInfo && !sameInfo(edits, serverInfo);

  useEffect(() => {
    setEdits(null);
  }, [
    groupId,
    serverInfo?.name,
    serverInfo?.description,
    serverInfo?.dailyWorklogEmailEnabled,
    serverInfo?.scheduleEnabled,
  ]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  if (isLoading || !group || !draft) {
    return (
      <div className="p-8">
        <EzSpinner label="Carregando grupo…" />
      </div>
    );
  }

  const memberIds = new Set(group.members.map((m) => m.id));
  const availableUsers = (allUsers ?? []).filter((u) => !memberIds.has(u.id));

  const orgIds = new Set(group.organizationLinks.map((l) => l.organization.id));
  const availableOrganizations = (allOrganizations ?? []).filter((o) => !orgIds.has(o.id));

  const deskIds = new Set(group.serviceDeskLinks.map((l) => l.serviceDesk.id));
  const availableServiceDesks = (allServiceDesks ?? []).filter((d) => !deskIds.has(d.id));

  return (
    <div className="space-y-5 p-5">
      <h2 className="text-[18px] font-semibold text-gray-900">{group.name}</h2>

      {actionError && (
        <EzAlert variant="error" onClose={() => setActionError(null)}>
          {actionError}
        </EzAlert>
      )}

      <EzTabs
        tabs={[
          { id: 'info', label: 'Informações' },
          { id: 'team', label: 'Equipe' },
          { id: 'access', label: 'Acessos' },
        ]}
        activeTab={tab}
        onChange={(id) => setTab(id as DetailTab)}
      />

      {tab === 'info' && (
        <div className="space-y-4">
          <EzTextInput
            id="tg-detail-name"
            label="Nome"
            value={draft.name}
            onChange={(e) => setEdits({ ...draft, name: e.target.value })}
          />
          <EzTextArea
            id="tg-detail-description"
            label="Descrição"
            value={draft.description}
            onChange={(e) => setEdits({ ...draft, description: e.target.value })}
          />
          <EzCheck
            id="tg-daily-worklog"
            label="Enviar e-mail diário de apontamentos"
            checked={draft.dailyWorklogEmailEnabled}
            onChange={(e) => setEdits({ ...draft, dailyWorklogEmailEnabled: e.target.checked })}
          />
          <EzCheck
            id="tg-schedule-enabled"
            label="Agenda habilitada"
            checked={draft.scheduleEnabled}
            onChange={(e) => setEdits({ ...draft, scheduleEnabled: e.target.checked })}
          />
          <div className="flex items-center justify-end gap-3">
            {dirty && <span className="text-[12px] font-medium text-gray-600">Alterações não salvas</span>}
            <EzButton
              size="small"
              disabled={!dirty}
              loading={updateMutation.isPending}
              onClick={() => run(updateMutation, draft, 'Grupo salvo')}
            >
              Salvar
            </EzButton>
          </div>
        </div>
      )}

      {tab === 'team' && (
        <EzDoubleList
          availableLabel="Usuários disponíveis"
          selectedLabel="Membros da equipe"
          available={availableUsers.map((u) => ({ id: u.id, label: u.name, description: u.email }))}
          selected={group.members.map((m) => ({ id: m.id, label: m.name, description: m.email }))}
          onAdd={(item) => run(addMember, String(item.id), 'Membro adicionado')}
          onRemove={(item) => run(removeMember, String(item.id), 'Membro removido')}
        />
      )}

      {tab === 'access' && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Clientes</h3>
            <EzDoubleList
              availableLabel="Clientes disponíveis"
              selectedLabel="Clientes vinculados"
              available={availableOrganizations.map((o) => ({ id: o.id, label: o.name }))}
              selected={group.organizationLinks.map((l) => ({
                id: l.organization.id,
                label: l.organization.name,
              }))}
              onAdd={(item) => run(addOrganization, String(item.id), 'Cliente vinculado')}
              onRemove={(item) => run(removeOrganization, String(item.id), 'Cliente desvinculado')}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Mesas de serviço</h3>
            <EzDoubleList
              availableLabel="Mesas disponíveis"
              selectedLabel="Mesas vinculadas"
              available={availableServiceDesks.map((d) => ({ id: d.id, label: d.name }))}
              selected={group.serviceDeskLinks.map((l) => ({
                id: l.serviceDesk.id,
                label: l.serviceDesk.name,
              }))}
              onAdd={(item) => run(addServiceDesk, String(item.id), 'Mesa vinculada')}
              onRemove={(item) => run(removeServiceDesk, String(item.id), 'Mesa desvinculada')}
            />
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para a lista
        </button>
      </div>
    </div>
  );
}

export function TechnicalGroupsPage() {
  const { data: groups, isLoading } = useTechnicalGroups();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailDirty, setDetailDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const leaveDetail = () => {
    setDiscardOpen(false);
    setDetailDirty(false);
    setSelectedGroupId(null);
  };
  const requestBack = () => (detailDirty ? setDiscardOpen(true) : leaveDetail());

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <EzPageLayout
      header={
        <EzPageHeader
          title="Grupos de atendentes"
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
            onNotify={setNotice}
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
            <EzEmptyCard title="Nenhum grupo de atendentes cadastrado." />
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

      {isCreateOpen && <CreateGroupModal onClose={() => setIsCreateOpen(false)} onNotify={setNotice} />}

      {notice && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 w-[calc(100%-2rem)] max-w-sm">
          <EzToast variant="success" title={notice} onClose={() => setNotice(null)} />
        </div>
      )}
    </EzPageLayout>
  );
}

export default TechnicalGroupsPage;
