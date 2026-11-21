import { useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../hooks/useUsers';
import {
  Copy,
  Eye,
  EyeOff,
  Trash2,
  Pencil,
  ExternalLink,
  FolderPlus,
  KeyRound,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  useVaultFolders,
  useVaultCredentials,
  useVaultMutations,
  useRevealCredential,
  VaultCredential,
  VaultFolder,
  CredentialInput,
} from '../hooks/useVault';
import { useAuthStore } from '../stores/authStore';
import {
  EzAlert,
  EzButton,
  EzActionsButton,
  EzCardItem,
  EzEmptyCard,
  EzModal,
  EzPageHeader,
  EzPageLayout,
  EzPagination,
  EzSelect,
  EzSpinner,
  EzTextInput,
  EzTree,
  EzTreeNode,
} from '../components/ds';

const ROOT_FOLDER_ID = 'root';
const PAGE_SIZE = 10;
const REVEAL_TTL_MS = 30_000;
const FEEDBACK_TTL_MS = 4_000;
const DANGER_ICON = 'text-red-600 hover:text-red-800';

type SecretField = 'username' | 'password';
type Feedback = { kind: 'success' | 'error'; text: string };

const SECRET_FIELDS: Record<SecretField, { noun: string; copied: string; copyError: string; revealError: string }> = {
  username: {
    noun: 'usuário',
    copied: 'Usuário copiado',
    copyError: 'Não foi possível copiar o usuário.',
    revealError: 'Não foi possível revelar o usuário.',
  },
  password: {
    noun: 'senha',
    copied: 'Senha copiada',
    copyError: 'Não foi possível copiar a senha.',
    revealError: 'Não foi possível revelar a senha.',
  },
};

function FolderModal({
  initialName,
  saving,
  error,
  onSave,
  onClose,
}: {
  initialName: string;
  saving: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const title = initialName ? 'Editar pasta' : 'Nova pasta';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (saving || !name.trim()) return;
    onSave(name.trim());
  };

  return (
    <EzModal
      isOpen
      onClose={onClose}
      title={title}
      aria-label={title}
      maxWidth="md"
      trapFocus
      preventOutsideClose
      dirty={name !== initialName}
      footer={<ModalFooter formId="vault-folder-form" saving={saving} onClose={onClose} />}
    >
      <form id="vault-folder-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <EzAlert variant="error">{error}</EzAlert>}
        <EzTextInput
          label="Nome da pasta"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
      </form>
    </EzModal>
  );
}

function ModalFooter({ formId, saving, onClose }: { formId: string; saving: boolean; onClose: () => void }) {
  return (
    <>
      <EzButton type="button" variant="secondary" label="Cancelar" disabled={saving} onClick={onClose} />
      <EzButton
        type="submit"
        form={formId}
        variant="primary"
        label={saving ? 'Salvando…' : 'Salvar'}
        disabled={saving}
        aria-busy={saving}
      />
    </>
  );
}

function CredentialModal({
  credential,
  folders,
  defaultFolderId,
  saving,
  error,
  onSave,
  onClose,
}: {
  credential?: VaultCredential;
  folders: VaultFolder[];
  defaultFolderId: string;
  saving: boolean;
  error: string | null;
  onSave: (dto: Partial<CredentialInput>) => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(credential);
  const [name, setName] = useState(credential?.name ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(credential?.url ?? '');
  const [description, setDescription] = useState(credential?.description ?? '');
  const initialFolderId = credential ? credential.folderId ?? ROOT_FOLDER_ID : defaultFolderId;
  const [folderId, setFolderId] = useState(initialFolderId);
  const title = isEdit ? 'Editar senha' : 'Nova senha';
  const dirty =
    name !== (credential?.name ?? '') ||
    username !== '' ||
    password !== '' ||
    url !== (credential?.url ?? '') ||
    description !== (credential?.description ?? '') ||
    folderId !== initialFolderId;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (saving || !name.trim()) return;
    if (!isEdit && !password.trim()) return;

    const dto: Partial<CredentialInput> = {
      name: name.trim(),
      url: url.trim() || undefined,
      description: description.trim() || undefined,
      folderId: folderId === ROOT_FOLDER_ID ? undefined : folderId,
    };
    if (username.trim()) dto.username = username.trim();
    if (password.trim()) dto.password = password.trim();
    onSave(dto);
  };

  return (
    <EzModal
      isOpen
      onClose={onClose}
      title={title}
      aria-label={title}
      maxWidth="md"
      trapFocus
      preventOutsideClose
      dirty={dirty}
      footer={<ModalFooter formId="vault-credential-form" saving={saving} onClose={onClose} />}
    >
      <form id="vault-credential-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <EzAlert variant="error">{error}</EzAlert>}
        <EzTextInput label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <EzTextInput
          label={isEdit ? 'Usuário (deixe em branco para não alterar)' : 'Usuário'}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <EzTextInput
          label={isEdit ? 'Senha (deixe em branco para não alterar)' : 'Senha'}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={!isEdit}
        />
        <EzTextInput label="URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <EzTextInput label="Notas" value={description} onChange={(e) => setDescription(e.target.value)} />
        <EzSelect label="Pasta" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value={ROOT_FOLDER_ID}>Raiz do cofre</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </EzSelect>
      </form>
    </EzModal>
  );
}

export function VaultPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === 'ADMIN';

  const [selectedFolderId, setSelectedFolderId] = useState<string>(ROOT_FOLDER_ID);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Keyed by `<credentialId>:<field>`; each revealed value hides itself after REVEAL_TTL_MS.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const revealTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped on every clear: a reveal that answers after it must not show its value.
  const generation = useRef(0);
  const [folderModal, setFolderModal] = useState<{ folder?: VaultFolder } | null>(null);
  const [credentialModal, setCredentialModal] = useState<{ credential?: VaultCredential } | null>(null);
  // Identifies the open modal: a save that answers after the modal was closed must not touch the next one.
  const modalIdRef = useRef(0);
  const [modalId, setModalId] = useState(0);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const foldersQuery = useVaultFolders();
  const credentialsQuery = useVaultCredentials({
    folderId: selectedFolderId,
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const {
    createFolderMutation,
    updateFolderMutation,
    removeFolderMutation,
    createCredentialMutation,
    updateCredentialMutation,
    removeCredentialMutation,
  } = useVaultMutations();
  const revealMutation = useRevealCredential();

  const foldersData = foldersQuery.data;
  const folders = useMemo<VaultFolder[]>(() => foldersData ?? [], [foldersData]);

  const treeNodes = useMemo<EzTreeNode[]>(
    () => [
      { id: ROOT_FOLDER_ID, label: 'Raiz do cofre' },
      ...folders.map((folder) => ({ id: folder.id, label: `${folder.name} (${folder.credentialCount})` })),
    ],
    [folders],
  );

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  useEffect(() => {
    const timers = revealTimers.current;
    return () => {
      generation.current += 1;
      timers.forEach(clearTimeout);
      clearTimeout(feedbackTimer.current);
    };
  }, []);

  const showFeedback = (next: Feedback | null) => {
    clearTimeout(feedbackTimer.current);
    setFeedback(next);
    if (next?.kind === 'success') feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_TTL_MS);
  };

  const hideField = (key: string) => {
    clearTimeout(revealTimers.current.get(key));
    revealTimers.current.delete(key);
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const hideAllFields = () => {
    generation.current += 1;
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current.clear();
    setRevealed({});
  };

  const handleSelectFolder = (node: EzTreeNode) => {
    setSelectedFolderId(String(node.id));
    setPage(1);
    hideAllFields();
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
    hideAllFields();
  };

  const handleChangePage = (next: number) => {
    setPage(next);
    hideAllFields();
  };

  const handleCopy = async (credentialId: string, field: SecretField) => {
    showFeedback(null);
    try {
      const value = await revealMutation.mutateAsync({ id: credentialId, field, intent: 'copy' });
      revealMutation.reset();
      if (!value) throw new Error('empty value');
      await navigator.clipboard.writeText(value);
      showFeedback({ kind: 'success', text: SECRET_FIELDS[field].copied });
    } catch {
      showFeedback({ kind: 'error', text: SECRET_FIELDS[field].copyError });
    }
  };

  const handleCopyUrl = async (url: string) => {
    showFeedback(null);
    try {
      await navigator.clipboard.writeText(url);
      showFeedback({ kind: 'success', text: 'URL copiada' });
    } catch {
      showFeedback({ kind: 'error', text: 'Não foi possível copiar a URL.' });
    }
  };

  const handleToggleReveal = async (credentialId: string, field: SecretField) => {
    const key = `${credentialId}:${field}`;
    if (key in revealed) {
      hideField(key);
      return;
    }

    showFeedback(null);
    const startedAt = generation.current;
    setPending((prev) => [...prev, key]);
    try {
      const value = await revealMutation.mutateAsync({ id: credentialId, field, intent: 'reveal' });
      revealMutation.reset();
      if (startedAt !== generation.current) return;
      if (!value) throw new Error('empty value');
      setRevealed((prev) => ({ ...prev, [key]: value }));
      revealTimers.current.set(key, setTimeout(() => hideField(key), REVEAL_TTL_MS));
    } catch {
      if (startedAt === generation.current) showFeedback({ kind: 'error', text: SECRET_FIELDS[field].revealError });
    } finally {
      setPending((prev) => prev.filter((pendingKey) => pendingKey !== key));
    }
  };

  const startModalSession = () => {
    modalIdRef.current += 1;
    setModalId(modalIdRef.current);
    setModalError(null);
  };
  const openFolderModal = (next: { folder?: VaultFolder }) => {
    startModalSession();
    setFolderModal(next);
  };
  const openCredentialModal = (next: { credential?: VaultCredential }) => {
    startModalSession();
    setCredentialModal(next);
  };
  const closeModals = () => {
    startModalSession();
    setFolderModal(null);
    setCredentialModal(null);
  };

  // The modal closes only when the API answers; a refusal keeps it open with what was typed.
  const runSave = async (action: () => Promise<unknown>, fallbackMessage: string) => {
    if (savingId === modalId) return;
    const id = modalIdRef.current;
    showFeedback(null);
    setModalError(null);
    setSavingId(id);
    try {
      await action();
      hideAllFields();
      if (id === modalIdRef.current) closeModals();
    } catch (error) {
      const message = apiErrorMessage(error, fallbackMessage);
      if (id === modalIdRef.current) setModalError(message);
      else showFeedback({ kind: 'error', text: message });
    } finally {
      setSavingId((current) => (current === id ? null : current));
    }
  };

  const handleSaveFolder = (name: string) => {
    const folder = folderModal?.folder;
    void runSave(
      () => (folder ? updateFolderMutation.mutateAsync({ id: folder.id, name }) : createFolderMutation.mutateAsync(name)),
      'Não foi possível salvar a pasta. Tente novamente.',
    );
  };

  const handleRemoveFolder = (folder: VaultFolder) => {
    if (!window.confirm(`Remover a pasta "${folder.name}"?`)) return;
    removeFolderMutation.mutate(folder.id, {
      onSuccess: () => {
        hideAllFields();
        if (selectedFolderId === folder.id) setSelectedFolderId(ROOT_FOLDER_ID);
      },
    });
  };

  const handleSaveCredential = (dto: Partial<CredentialInput>) => {
    const credential = credentialModal?.credential;
    void runSave(
      () =>
        credential
          ? updateCredentialMutation.mutateAsync({ id: credential.id, ...dto })
          : createCredentialMutation.mutateAsync(dto as CredentialInput),
      'Não foi possível salvar a senha. Tente novamente.',
    );
  };

  const handleRemoveCredential = (cred: VaultCredential) => {
    if (!window.confirm('Excluir senha definitivamente?')) return;
    hideAllFields();
    removeCredentialMutation.mutate(cred.id);
  };

  const renderSecret = (cred: VaultCredential, field: SecretField) => {
    if (!(field === 'username' ? cred.hasUsername : cred.hasPassword)) return <span className="text-gray-400">—</span>;
    const { noun } = SECRET_FIELDS[field];
    const key = `${cred.id}:${field}`;
    const shown = key in revealed;
    return (
      <div className="flex items-center gap-1 text-gray-700">
        <span>{shown ? revealed[key] : '••••••••'}</span>
        <EzButton
          variant="tertiary"
          size="small"
          leftIcon={shown ? EyeOff : Eye}
          title={shown ? `Ocultar ${noun}` : `Revelar ${noun}`}
          aria-label={`Revelar ${noun} de ${cred.name}`}
          aria-pressed={shown}
          disabled={pending.includes(key)}
          aria-busy={pending.includes(key)}
          onClick={() => handleToggleReveal(cred.id, field)}
        />
        <EzButton
          variant="tertiary"
          size="small"
          leftIcon={Copy}
          title={`Copiar ${noun}`}
          aria-label={`Copiar ${noun} de ${cred.name}`}
          onClick={() => handleCopy(cred.id, field)}
        />
      </div>
    );
  };

  // Only the queries that failed are fetched again.
  const retryLoad = () => {
    if (foldersQuery.isError) void foldersQuery.refetch();
    if (credentialsQuery.isError) void credentialsQuery.refetch();
  };

  if (foldersQuery.isLoading || credentialsQuery.isLoading)
    return (
      <EzPageLayout header={<EzPageHeader title="Cofre de Senhas" />}>
        <div className="flex justify-center p-8">
          <EzSpinner label="Carregando cofre..." />
        </div>
      </EzPageLayout>
    );
  if (foldersQuery.isError || credentialsQuery.isError)
    return (
      <EzPageLayout header={<EzPageHeader title="Cofre de Senhas" />}>
        <div className="space-y-3 p-8">
          <EzAlert variant="error">Erro ao carregar o cofre de senhas.</EzAlert>
          <EzButton variant="secondary" label="Tentar de novo" onClick={retryLoad} />
        </div>
      </EzPageLayout>
    );

  const credentials = credentialsQuery.data?.data ?? [];
  const meta = credentialsQuery.data?.meta;

  return (
    <EzPageLayout
      header={
        <EzPageHeader
          title="Cofre de Senhas"
          actions={
            canEdit && (
              <EzButton
                variant="secondary"
                label="Auditoria"
                leftIcon={ShieldCheck}
                onClick={() => navigate('/vault/audit')}
              />
            )
          }
        />
      }
    >
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <EzCardItem flat className="p-3">
          <EzTree
            nodes={treeNodes}
            selectedId={selectedFolderId}
            onSelect={handleSelectFolder}
            defaultExpandedIds={[]}
          />
        </EzCardItem>

        <EzCardItem flat className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <EzTextInput
                type="search"
                placeholder="Buscar senha..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
                className="max-w-xs"
              />
              {canEdit && selectedFolder && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>
                    Pasta: <strong>{selectedFolder.name}</strong>
                  </span>
                  <EzButton
                    variant="tertiary"
                    size="small"
                    leftIcon={Pencil}
                    title="Editar pasta"
                    aria-label={`Editar pasta ${selectedFolder.name}`}
                    onClick={() => openFolderModal({ folder: selectedFolder })}
                  />
                  <EzButton
                    variant="tertiary"
                    size="small"
                    leftIcon={Trash2}
                    title="Remover pasta"
                    aria-label={`Remover pasta ${selectedFolder.name}`}
                    className={DANGER_ICON}
                    onClick={() => handleRemoveFolder(selectedFolder)}
                  />
                </div>
              )}
            </div>
            {canEdit && (
              <EzActionsButton
                label="Ações"
                actions={[
                  { label: 'Nova pasta', icon: <FolderPlus className="h-4 w-4" />, onClick: () => openFolderModal({}) },
                  { label: 'Nova senha', icon: <KeyRound className="h-4 w-4" />, onClick: () => openCredentialModal({}) },
                ]}
              />
            )}
          </div>

          <div role="status" aria-live="polite">
            {feedback?.kind === 'success' && (
              <p className="border-b border-gray-100 bg-green-100 px-4 py-2 text-sm text-green-800">{feedback.text}</p>
            )}
          </div>
          {feedback?.kind === 'error' && (
            <EzAlert variant="error" className="m-3" onClose={() => showFeedback(null)}>
              {feedback.text}
            </EzAlert>
          )}

          {!credentials.length ? (
            <EzEmptyCard title="Nenhuma credencial liberada para esta operação." />
          ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-[14px]">
            <thead className="bg-gray-90/60 text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Usuário</th>
                <th className="px-4 py-2 font-medium">Senha</th>
                <th className="px-4 py-2 font-medium">URL</th>
                {canEdit && <th className="px-4 py-2 font-medium text-right">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {credentials.map((cred) => (
                <tr key={cred.id} className="hover:bg-gray-90/40">
                  <td className="px-4 py-1.5">
                    <span className="font-medium text-gray-900">{cred.name}</span>
                  </td>
                  <td className="px-4 py-1.5">{renderSecret(cred, 'username')}</td>
                  <td className="px-4 py-1.5">{renderSecret(cred, 'password')}</td>
                  <td className="px-4 py-1.5">
                    {cred.url ? (
                      <div className="flex items-center gap-1 text-gray-700">
                        <span className="truncate max-w-[160px]" title={cred.url}>{cred.url}</span>
                        <EzButton
                          variant="tertiary"
                          size="small"
                          leftIcon={Copy}
                          title="Copiar URL"
                          aria-label={`Copiar URL de ${cred.name}`}
                          onClick={() => handleCopyUrl(cred.url ?? '')}
                        />
                        <a
                          href={cred.url}
                          target="_blank"
                          rel="noreferrer"
                          title="Abrir URL"
                          aria-label={`Abrir URL de ${cred.name}`}
                          className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-full text-brand-600 hover:text-brand-800 ez-focus"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-1.5 text-right">
                      <div className="flex justify-end gap-1">
                        <EzButton
                          variant="tertiary"
                          size="small"
                          leftIcon={Pencil}
                          title="Editar"
                          aria-label={`Editar ${cred.name}`}
                          onClick={() => openCredentialModal({ credential: cred })}
                        />
                        <EzButton
                          variant="tertiary"
                          size="small"
                          leftIcon={Trash2}
                          title="Excluir"
                          aria-label={`Excluir ${cred.name}`}
                          className={DANGER_ICON}
                          onClick={() => handleRemoveCredential(cred)}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="flex justify-end border-t border-gray-100 px-4 py-3">
              <EzPagination currentPage={meta.page} totalPages={meta.totalPages} onChange={handleChangePage} />
            </div>
          )}
        </EzCardItem>
      </div>

      {folderModal && (
        <FolderModal
          initialName={folderModal.folder?.name ?? ''}
          saving={savingId === modalId}
          error={modalError}
          onSave={handleSaveFolder}
          onClose={closeModals}
        />
      )}

      {credentialModal && (
        <CredentialModal
          credential={credentialModal.credential}
          folders={folders}
          defaultFolderId={selectedFolderId}
          saving={savingId === modalId}
          error={modalError}
          onSave={handleSaveCredential}
          onClose={closeModals}
        />
      )}
    </div>
    </EzPageLayout>
  );
}
