import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import axios from 'axios';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useApiTokens } from '../hooks/useApiTokens';
import { EzAlert, EzButton, EzDialog, EzTabs, EzTextInput, ezTabId, ezTabPanelId } from '../components/ds';
import { PasswordRules, PolicyErrors } from '../components/PasswordRules';
import { TwoFactorSection } from '../components/TwoFactorSection';
import { allRulesMet, policyMessages } from '../lib/passwordRules';

// Mesmas regras do registro (passwordRules); o servidor continua sendo a autoridade.
const buildChangePasswordSchema = (email?: string) =>
  z
    .object({
      currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
      newPassword: z.string().min(1, 'Nova senha é obrigatória'),
      confirmNewPassword: z.string(),
    })
    .superRefine(({ newPassword, confirmNewPassword }, ctx) => {
      if (newPassword && !allRulesMet(newPassword, { email })) {
        ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'A senha não atende a todas as regras da lista.' });
      }
      if (confirmNewPassword !== newPassword) {
        ctx.addIssue({ code: 'custom', path: ['confirmNewPassword'], message: 'As senhas não coincidem.' });
      }
    });
type ChangePasswordFormValues = z.infer<ReturnType<typeof buildChangePasswordSchema>>;

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  email: z.string().trim().email('E-mail inválido'),
});
type ProfileFormValues = z.infer<typeof profileSchema>;

type Tab = 'profile' | 'security' | 'tokens';
const TAB_IDS: readonly Tab[] = ['profile', 'security', 'tokens'];
const ACCOUNT_TABS_ID = 'my-account';

/**
 * Mirrors the Tiflux reference UI (accessed 2026-09-30): "Minha conta"
 * opens a tabbed page — a "Minha conta" tab for profile fields (name,
 * email, ...) and a "Segurança" tab holding the change-password form.
 * Only name/email are implemented here; photo/phone/language etc. from
 * the reference are out of scope for now.
 *
 * "Tokens de API" is Aponta-specific (no Tiflux equivalent): lets ANY
 * role mint a personal Bearer token (scoped to their own current
 * role/organization, enforced server-side) to drive the REST API from
 * outside the browser — e.g. the apps/mcp MCP server for LLM clients.
 */
export function MyAccountPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: Tab = TAB_IDS.find((id) => id === requested) ?? 'profile';

  const tabs = [
    { id: 'profile', label: 'Minha Conta' },
    { id: 'security', label: 'Segurança' },
    { id: 'tokens', label: 'Tokens de API' },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-gray-900">Minha Conta</h1>

      <EzTabs
        tabs={tabs}
        activeTab={tab}
        idPrefix={ACCOUNT_TABS_ID}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />

      <div
        role="tabpanel"
        id={ezTabPanelId(ACCOUNT_TABS_ID, tab)}
        aria-labelledby={ezTabId(ACCOUNT_TABS_ID, tab)}
        className="pt-2"
      >
        {tab === 'profile' && <ProfileTab />}
        {tab === 'security' && (
          <div className="space-y-6">
            <SecurityTab />
            <TwoFactorSection />
          </div>
        )}
        {tab === 'tokens' && <ApiTokensTab />}
      </div>
    </div>
  );
}

function ProfileTab() {
  const user = useAuthStore((state) => state.user);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [attempt, setAttempt] = useState(0);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: '', email: user?.email ?? '' },
  });

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    api
      .get<{ name: string; email: string }>('/auth/me')
      .then((response) => {
        if (!cancelled) {
          // keepDirtyValues: a slow response must not overwrite what the user
          // already typed (the PATCH would then save the old values).
          reset(
            { name: response.data.name, email: response.data.email },
            { keepDirtyValues: true },
          );
          setLoadState('ready');
        }
      })
      .catch(() => {
        // Sem os dados reais o e-mail do token pode estar obsoleto: avisa e
        // bloqueia o Salvar até uma nova tentativa funcionar.
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [reset, attempt]);

  const onSubmit = async (values: ProfileFormValues) => {
    setSubmitError(null);
    setSuccess(false);
    try {
      await api.patch('/auth/me', values);
      setSuccess(true);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setSubmitError('Esse e-mail já está em uso por outra conta.');
      } else {
        setSubmitError('Algo deu errado. Tente novamente.');
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-6"
    >
      {loadState === 'error' && (
        <EzAlert variant="error" role="alert">
          <div className="flex flex-wrap items-center gap-3">
            <span>Não foi possível carregar seus dados.</span>
            <EzButton type="button" size="small" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Tentar novamente
            </EzButton>
          </div>
        </EzAlert>
      )}

      <EzTextInput
        id="name"
        label="Nome"
        hasError={!!errors.name}
        message={errors.name?.message}
        {...register('name')}
      />

      <EzTextInput
        id="email"
        type="email"
        label="E-mail"
        hasError={!!errors.email}
        message={errors.email?.message}
        {...register('email')}
      />

      {submitError && (
        <EzAlert variant="error" role="alert">
          {submitError}
        </EzAlert>
      )}
      {success && (
        <EzAlert variant="success" role="status">
          Dados atualizados com sucesso!
        </EzAlert>
      )}

      <EzButton
        type="submit"
        disabled={isSubmitting || loadState !== 'ready'}
        disabledReason={loadState === 'ready' ? undefined : 'Aguarde os dados da conta carregarem.'}
        className="w-full"
      >
        Salvar
      </EzButton>
    </form>
  );
}

function SecurityTab() {
  const email = useAuthStore((state) => state.user?.email);
  const login = useAuthStore((state) => state.login);
  const [submitError, setSubmitError] = useState<ReactNode>(null);
  const [success, setSuccess] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(useMemo(() => buildChangePasswordSchema(email), [email])),
  });

  const onSubmit = async (values: ChangePasswordFormValues) => {
    setSubmitError(null);
    setSuccess(false);

    try {
      const { confirmNewPassword: _confirmNewPassword, ...payload } = values;
      const { data } = await api.post<{ access_token?: string }>('/auth/change-password', payload);
      // A troca derruba os outros tokens; a sessão atual guarda o novo.
      if (data?.access_token) login(data.access_token);
      setSuccess(true);
      reset();
    } catch (error) {
      const rules = policyMessages(error);
      if (rules) {
        setSubmitError(<PolicyErrors messages={rules} />);
      } else if (axios.isAxiosError(error) && error.response?.status === 401) {
        setSubmitError('Senha atual incorreta.');
      } else {
        setSubmitError('Algo deu errado. Tente novamente.');
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-6"
    >
      <h2 className="text-lg font-semibold text-gray-900">Alterar senha</h2>

      <EzTextInput
        id="currentPassword"
        type="password"
        autoComplete="current-password"
        label="Senha atual"
        hasError={!!errors.currentPassword}
        message={errors.currentPassword?.message}
        {...register('currentPassword')}
      />

      <EzTextInput
        id="newPassword"
        type="password"
        autoComplete="new-password"
        label="Nova senha"
        hasError={!!errors.newPassword}
        message={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <PasswordRules password={watch('newPassword') ?? ''} email={email} />

      <EzTextInput
        id="confirmNewPassword"
        type="password"
        autoComplete="new-password"
        label="Confirmar nova senha"
        hasError={!!errors.confirmNewPassword}
        message={errors.confirmNewPassword?.message}
        {...register('confirmNewPassword')}
      />

      {submitError && (
        <EzAlert variant="error" role="alert">
          {submitError}
        </EzAlert>
      )}
      {success && (
        <EzAlert variant="success" role="status">
          Senha atualizada com sucesso! Você saiu dos outros aparelhos.
        </EzAlert>
      )}

      <EzButton type="submit" disabled={isSubmitting} className="w-full">
        Trocar senha
      </EzButton>
    </form>
  );
}

export default MyAccountPage;

function ApiTokensTab() {
  const { listQuery, createMutation, revokeMutation } = useApiTokens();
  const [name, setName] = useState('');
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreateError(null);
    try {
      const created = await createMutation.mutateAsync(name.trim());
      setJustCreatedToken(created.token);
      setCopied(false);
      setCopyError(false);
      setConfirmClose(false);
      setName('');
    } catch {
      setCreateError('Não foi possível gerar o token. Tente novamente.');
    }
  };

  const handleCopy = async () => {
    if (!justCreatedToken) return;
    try {
      await navigator.clipboard.writeText(justCreatedToken);
      setCopied(true);
      setCopyError(false);
      setConfirmClose(false);
    } catch {
      // Fora de HTTPS ou sem permissão o clipboard recusa: não marcar "Copiado!".
      setCopied(false);
      setCopyError(true);
    }
  };

  const handleClose = () => {
    if (!copied && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    setJustCreatedToken(null);
    setConfirmClose(false);
    setCopyError(false);
  };

  const confirmRevoke = () => {
    if (!revokeTarget) return;
    revokeMutation.mutate(revokeTarget.id, { onSettled: () => setRevokeTarget(null) });
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Nunca usado';
    return new Date(iso).toLocaleString('pt-BR');
  };

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Tokens de API</h2>
        <p className="mt-1 text-sm text-gray-500">
          Gere um token pessoal para integrações externas (ex: servidor MCP para IAs).
          O token herda exatamente o mesmo nível de acesso da sua conta.
        </p>
      </div>

      {justCreatedToken && (
        <div className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            Copie seu token agora — ele não será exibido novamente!
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded border border-gray-200 bg-white px-2 py-1 text-xs">
              {justCreatedToken}
            </code>
            <EzButton
              type="button"
              size="small"
              onClick={handleCopy}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </EzButton>
          </div>
          {copyError && (
            <EzAlert variant="error" role="alert">
              Não foi possível copiar automaticamente. Selecione o token acima e copie manualmente.
            </EzAlert>
          )}
          {confirmClose && (
            <p className="text-xs font-medium text-amber-800">
              Você ainda não copiou o token e ele não será exibido de novo.
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="text-xs text-amber-700 hover:underline"
            >
              Entendi, fechar
            </button>
            {confirmClose && (
              <button
                type="button"
                onClick={handleClose}
                className="text-xs font-semibold text-red-700 hover:underline"
              >
                Fechar sem copiar
              </button>
            )}
          </div>
        </div>
      )}

      {createError && (
        <EzAlert variant="error" role="alert">
          {createError}
        </EzAlert>
      )}

      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div className="flex-1">
          <EzTextInput
            id="token-name"
            label="Nome do token"
            placeholder="Ex: Claude Desktop"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </div>
        <EzButton
          type="submit"
          disabled={createMutation.isPending || !name.trim()}
          className="whitespace-nowrap"
        >
          Gerar Token
        </EzButton>
      </form>

      <div className="space-y-2">
        {listQuery.isLoading && (
          <p className="text-sm text-gray-500">Carregando...</p>
        )}
        {!listQuery.isLoading && listQuery.data?.length === 0 && (
          <p className="text-sm text-gray-500">Nenhum token criado ainda.</p>
        )}
        {listQuery.data?.map((token) => (
          <div
            key={token.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">{token.name}</p>
              <p className="text-xs text-gray-500">
                Criado em {formatDate(token.createdAt)} · Último uso: {formatDate(token.lastUsedAt)}
              </p>
            </div>
            <EzButton
              type="button"
              variant="danger"
              size="small"
              onClick={() => setRevokeTarget({ id: token.id, name: token.name })}
            >
              Revogar
            </EzButton>
          </div>
        ))}
      </div>

      <EzDialog
        open={revokeTarget !== null}
        variant="danger"
        title="Revogar token?"
        message={`O token "${revokeTarget?.name ?? ''}" será revogado e qualquer integração usando-o perderá acesso imediatamente. Essa ação não pode ser desfeita.`}
        confirmLabel="Revogar token"
        confirmLoading={revokeMutation.isPending}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
