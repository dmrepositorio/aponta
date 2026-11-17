import { FormEvent, ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../../lib/api';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useHasPermission } from '../../hooks/usePermissions';
import { usePermissionGroups } from '../../hooks/usePermissionGroups';
import { useTechnicalGroups } from '../../hooks/useTechnicalGroups';
import {
  UserInput,
  UserListItem,
  apiErrorMessage,
  apiErrorStatus,
  useCreateUser,
  useSendUserLink,
  useSetUserActive,
  useUpdateUser,
} from '../../hooks/useUsers';
import { ActiveTag } from '../ActiveTag';
import { useMesaSave } from '../mesaSave';
import {
  EzAlert,
  EzButton,
  EzCardItem,
  EzCheck,
  EzComboBox,
  EzDialog,
  EzTabs,
  EzTextInput,
  ezTabId,
  ezTabPanelId,
} from '../ds';

export const USER_LINKS_FLAG = 'convite-e-redefinicao-usuario';

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  AGENT_MASTER: 'Gerente de Atendimento',
  AGENT: 'Atendente',
  CLIENT_MASTER: 'Cliente Master',
  CLIENT: 'Cliente',
};

/** Campos do formulário como texto; ver `buildPatch` para o que vai ao servidor. */
interface Draft {
  name: string;
  email: string;
  role: string;
  phone: string;
  extension: string;
  organizationId: string;
  technicalGroupId: string;
  permissionGroupIds: string[];
}

const EMPTY: Draft = {
  name: '',
  email: '',
  role: '',
  phone: '',
  extension: '',
  organizationId: '',
  technicalGroupId: '',
  permissionGroupIds: [],
};

const draftOf = (user: UserListItem): Draft => ({
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone ?? '',
  extension: user.extension ?? '',
  organizationId: user.organizationId ?? '',
  technicalGroupId: user.technicalGroup?.id ?? '',
  permissionGroupIds: user.permissionGroups.map((group) => group.id),
});

// Limites iguais aos do DTO da API (a validação do servidor é a que vale).
const schema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120, 'Nome muito longo'),
  email: z.string().trim().min(1, 'E-mail é obrigatório').max(254, 'E-mail inválido').email('E-mail inválido'),
  role: z.string().min(1, 'Tipo é obrigatório'),
  phone: z.string().trim().max(30, 'Telefone muito longo'),
  extension: z.string().trim().max(20, 'Ramal muito longo'),
});

type Field = 'name' | 'email' | 'role' | 'phone' | 'extension';
const FIELD_ORDER: Field[] = ['name', 'email', 'role', 'phone', 'extension'];

function validate(draft: Draft): Partial<Record<Field, string>> {
  const result = schema.safeParse(draft);
  if (result.success) return {};
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of result.error.issues) errors[issue.path[0] as Field] ??= issue.message;
  return errors;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** O que mudou entre `base` e `draft`, no formato da API: `null` limpa os opcionais; vazio e igual não vai. */
function buildPatch(draft: Draft, base: Draft): Partial<UserInput> {
  const patch: Partial<UserInput> = {};
  for (const key of ['name', 'email'] as const) {
    if (draft[key].trim() !== base[key].trim()) patch[key] = draft[key].trim();
  }
  if (draft.role !== base.role) patch.role = draft.role;
  for (const key of ['phone', 'extension', 'organizationId', 'technicalGroupId'] as const) {
    if (draft[key].trim() !== base[key].trim()) patch[key] = draft[key].trim() || null;
  }
  if (!sameSet(draft.permissionGroupIds, base.permissionGroupIds)) patch.permissionGroupIds = draft.permissionGroupIds;
  return patch;
}

function focusField(id: string) {
  const el = document.getElementById(id);
  // EzSelect: o select nativo fica escondido, o foco vai para o controle visível ao lado.
  (el instanceof HTMLSelectElement ? el.parentElement?.querySelector('button') : el)?.focus();
}

function Labeled({ id, label, required, children }: { id: string; label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="mb-0.5 text-[14px] font-medium leading-none text-gray-900">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-red-600">
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

interface Option {
  id: string;
  name: string;
}
/** Lista da API mais o que o usuário já tem (a lista pode ainda estar carregando). */
const withCurrent = (list: Option[] | undefined, current: Option[]) => [
  ...(list ?? []),
  ...current.filter((item) => !list?.some((other) => other.id === item.id)),
];

/**
 * Aba Geral: um rascunho, um Salvar, no modelo de salvamento da Mesa (DMTE-533). Sem `user`, cadastra
 * (sem senha: o usuário nasce com convite pendente); com `user`, edita só o que mudou.
 */
function GeneralPanel({ user, onCreated }: { user?: UserListItem; onCreated?: (user: UserListItem) => void }) {
  const isNew = !user;
  const canChangeRole = useHasPermission('CHANGE_USER_ROLE');
  const [baseline, setBaseline] = useState<Draft>(() => (user ? draftOf(user) : EMPTY));
  const [draft, setDraft] = useState(baseline);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<{ email?: string; other?: string }>({});
  const dirty = Object.keys(buildPatch(draft, baseline)).length > 0;
  const feedback = useMesaSave(dirty);
  const create = useCreateUser();
  const update = useUpdateUser(user?.id ?? '');
  const pending = create.isPending || update.isPending;

  const { data: technicalGroups } = useTechnicalGroups();
  const { data: permissionGroups } = usePermissionGroups();
  const { data: organizations } = useQuery({
    queryKey: ['organizations', 'options'],
    queryFn: async () => (await api.get<Option[]>('/organizations')).data,
  });

  const errors = submitted ? validate(draft) : {};
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key === 'email') setServerError((prev) => ({ ...prev, email: undefined }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    const invalid = validate(draft);
    const first = FIELD_ORDER.find((field) => invalid[field]);
    if (first) return focusField(`user-${first}`);
    const patch = buildPatch(draft, baseline);
    if (!isNew && Object.keys(patch).length === 0) return;

    setServerError({});
    const sent = draft;
    // 409 é e-mail já cadastrado: o erro vai no campo.
    const fail = (error: unknown) =>
      setServerError(apiErrorStatus(error) === 409 ? { email: apiErrorMessage(error) } : { other: apiErrorMessage(error) });
    if (isNew) {
      create.mutate(patch, {
        onSuccess: (created) => {
          feedback.saved();
          onCreated?.(created);
        },
        onError: fail,
      });
    } else {
      update.mutate(patch, {
        onSuccess: () => {
          setBaseline(sent);
          feedback.saved();
        },
        onError: fail,
      });
    }
  };

  const roleChanged = !isNew && draft.role !== baseline.role;
  const technicalOptions = withCurrent(technicalGroups, user?.technicalGroup ? [user.technicalGroup] : []);
  const permissionOptions = withCurrent(permissionGroups, user?.permissionGroups ?? []);

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div aria-live="polite">
        {dirty && (
          <p className="flex items-center gap-2 text-sm text-gray-700">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-600" />
            Alterações não salvas.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EzTextInput
          id="user-name"
          label="Nome"
          required
          autoComplete="off"
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          hasError={!!errors.name}
          message={errors.name}
        />
        <EzTextInput
          id="user-email"
          label="E-mail"
          type="email"
          required
          autoComplete="off"
          spellCheck={false}
          value={draft.email}
          onChange={(e) => set('email', e.target.value)}
          hasError={!!(errors.email || serverError.email)}
          message={errors.email ?? serverError.email}
        />

        <Labeled id="user-role" label="Tipo" required>
          <EzComboBox
            id="user-role"
            value={draft.role}
            disabled={!isNew && !canChangeRole}
            onChange={(e) => set('role', e.target.value)}
            hasError={!!errors.role}
            message={errors.role}
          >
            {isNew && <option value="">Selecione…</option>}
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </EzComboBox>
          {roleChanged && (
            <p className="text-xs text-gray-700">
              Trocar o tipo não troca os grupos de permissões já vinculados. Revise-os abaixo, se for preciso.
            </p>
          )}
        </Labeled>
        <Labeled id="user-organization" label="Cliente">
          <EzComboBox
            id="user-organization"
            value={draft.organizationId}
            onChange={(e) => set('organizationId', e.target.value)}
          >
            <option value="">Nenhum</option>
            {(organizations ?? []).map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </EzComboBox>
        </Labeled>

        <EzTextInput
          id="user-phone"
          label="Telefone"
          type="tel"
          autoComplete="off"
          value={draft.phone}
          onChange={(e) => set('phone', e.target.value)}
          hasError={!!errors.phone}
          message={errors.phone}
        />
        <EzTextInput
          id="user-extension"
          label="Ramal"
          autoComplete="off"
          value={draft.extension}
          onChange={(e) => set('extension', e.target.value)}
          hasError={!!errors.extension}
          message={errors.extension}
        />

        <Labeled id="user-technical-group" label="Grupo de atendentes">
          <EzComboBox
            id="user-technical-group"
            value={draft.technicalGroupId}
            onChange={(e) => set('technicalGroupId', e.target.value)}
          >
            <option value="">Nenhum</option>
            {technicalOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </EzComboBox>
        </Labeled>

        <fieldset className="space-y-2 md:col-span-2">
          <legend className="mb-1 text-[14px] font-medium text-gray-900">Grupos de permissões</legend>
          {permissionOptions.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum grupo de permissões cadastrado.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {permissionOptions.map((group) => (
                <EzCheck
                  key={group.id}
                  id={`user-pg-${group.id}`}
                  label={group.name}
                  checked={draft.permissionGroupIds.includes(group.id)}
                  onChange={() =>
                    set(
                      'permissionGroupIds',
                      draft.permissionGroupIds.includes(group.id)
                        ? draft.permissionGroupIds.filter((id) => id !== group.id)
                        : [...draft.permissionGroupIds, group.id],
                    )
                  }
                />
              ))}
            </div>
          )}
        </fieldset>
      </div>

      {serverError.other && <EzAlert variant="error">{serverError.other}</EzAlert>}

      <div className="flex justify-end">
        <EzButton type="submit" label="Salvar" disabled={pending || (!isNew && !dirty)} />
      </div>
    </form>
  );
}

/** Aba Segurança: situação (ativar e inativar, com confirmação) e convite ou redefinição de senha. */
function SecurityPanel({ user }: { user: UserListItem }) {
  const linksOn = useFeatureFlag(USER_LINKS_FLAG);
  const canSend = useHasPermission('SEND_USER_INVITES_AND_RESETS');
  const canToggle = useHasPermission('ACTIVATE_DEACTIVATE_USERS');
  const setActive = useSetUserActive();
  const kind = user.pending ? 'invite' : 'password-reset';
  const send = useSendUserLink(user.id, kind);
  const [confirming, setConfirming] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [linkResult, setLinkResult] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = () => {
    setConfirming(false);
    setActiveError(null);
    setActive.mutate({ id: user.id, active: !user.active }, { onError: (error) => setActiveError(apiErrorMessage(error)) });
  };

  const sendLink = () => {
    setLinkResult(null);
    send.mutate(undefined, {
      onSuccess: () => {
        setSent(true);
        setLinkResult({ ok: true, text: user.pending ? 'Convite enviado.' : 'Redefinição de senha enviada.' });
      },
      onError: (error) =>
        setLinkResult({
          ok: false,
          text:
            apiErrorStatus(error) === 502
              ? 'Não foi possível enviar o e-mail. Tente novamente.'
              : apiErrorMessage(error),
        }),
    });
  };

  const blocked = !linksOn
    ? 'O envio de convites e de redefinições de senha ainda não foi ativado neste ambiente.'
    : !canSend
      ? 'Você não tem permissão para enviar convites nem redefinições de senha.'
      : null;
  const verb = user.active ? 'Inativar' : 'Ativar';

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-[14px] font-semibold text-gray-900">Situação</h3>
        <div className="flex flex-wrap items-center gap-3">
          <ActiveTag active={user.active} pending={user.pending} />
          <EzButton
            type="button"
            variant="secondary"
            size="small"
            label={verb}
            disabled={!canToggle || setActive.isPending}
            onClick={() => setConfirming(true)}
          />
        </div>
        {activeError && <EzAlert variant="error">{activeError}</EzAlert>}
      </section>

      {(user.pending || user.active) && (
        <section className="space-y-2">
          <h3 className="text-[14px] font-semibold text-gray-900">{user.pending ? 'Convite' : 'Redefinição de senha'}</h3>
          <p className="text-sm text-gray-700">
            {user.pending
              ? 'O usuário ainda não definiu a senha. O convite é um link de uso único, válido por 72 horas; reenviar anula o anterior.'
              : 'Envia ao usuário um link para criar uma nova senha, válido por 24 horas. A senha atual vale até o link ser usado.'}
          </p>
          <EzButton
            type="button"
            variant="secondary"
            size="small"
            label={user.pending ? (sent ? 'Reenviar convite' : 'Enviar convite') : 'Redefinir senha'}
            disabled={!!blocked || send.isPending}
            aria-describedby={blocked ? 'user-link-blocked' : undefined}
            onClick={sendLink}
          />
          {blocked && (
            <p id="user-link-blocked" className="text-xs text-gray-700">
              {blocked}
            </p>
          )}
          <div aria-live="polite">
            {linkResult &&
              (linkResult.ok ? (
                <p className="text-sm font-medium text-green-800">{linkResult.text}</p>
              ) : (
                <EzAlert variant="error">{linkResult.text}</EzAlert>
              ))}
          </div>
        </section>
      )}

      <EzDialog
        open={confirming}
        variant={user.active ? 'warning' : 'info'}
        title={`${verb} usuário?`}
        message={user.active ? 'O usuário perde o acesso ao Aponta na hora.' : 'O usuário volta a poder acessar o Aponta.'}
        onCancel={() => setConfirming(false)}
        onConfirm={toggle}
      />
    </div>
  );
}

const TABS_ID = 'user-tabs';
const TABS = [
  { id: 'general', label: 'Geral' },
  { id: 'security', label: 'Segurança' },
];

/** Cadastro de um usuário: novo (só Geral) ou existente (Geral e Segurança). */
export function UserForm({ user, onCreated }: { user?: UserListItem; onCreated?: (user: UserListItem) => void }) {
  const [tab, setTab] = useState('general');
  if (!user) return <GeneralPanel onCreated={onCreated} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-[18px] font-semibold text-gray-900">{user.name}</h2>
        <ActiveTag active={user.active} pending={user.pending} />
      </div>
      <EzTabs tabs={TABS} activeTab={tab} onChange={(id) => setTab(String(id))} idPrefix={TABS_ID} />
      <EzCardItem
        flat
        className="p-5 md:p-6"
        role="tabpanel"
        id={ezTabPanelId(TABS_ID, tab)}
        aria-labelledby={ezTabId(TABS_ID, tab)}
      >
        {/* Escondida, não desmontada: o rascunho da aba Geral sobrevive à troca de aba. */}
        <div hidden={tab !== 'general'}>
          <GeneralPanel user={user} />
        </div>
        {tab === 'security' && <SecurityPanel user={user} />}
      </EzCardItem>
    </div>
  );
}
