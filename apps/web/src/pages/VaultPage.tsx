import { useEffect, useMemo, useRef, useState, FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useEscapeLayer } from '../hooks/useEscapeLayer';
import {
  Lock,
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
  X,
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

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscapeLayer(onClose);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-gray-900/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-[24px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <span className="text-[16px] font-semibold text-gray-900">{title}</span>
          <button onClick={onClose} aria-label="Fechar" className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function FolderModal({
  initialName,
  onSave,
  onClose,
}: {
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim());
  };

  return (
    <Modal title={initialName ? 'Editar pasta' : 'Nova pasta'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <EzTextInput
          label="Nome da pasta"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <div className="flex justify-end gap-3">
          <EzButton type="button" variant="secondary" label="Cancelar" onClick={onClose} />
          <EzButton type="submit" variant="primary" label="Salvar" />
        </div>
      </form>
    </Modal>
  );
}

function CredentialModal({
  credential,
  folders,
  defaultFolderId,
  onSave,
  onClose,
}: {
  credential?: VaultCredential;
  folders: VaultFolder[];
  defaultFolderId: string;
  onSave: (dto: Partial<CredentialInput>) => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(credential);
  const [name, setName] = useState(credential?.name ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(credential?.url ?? '');
  const [description, setDescription] = useState(credential?.description ?? '');
  const [folderId, setFolderId] = useState(
    credential ? credential.folderId ?? ROOT_FOLDER_ID : defaultFolderId,
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
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
    <Modal title={isEdit ? 'Editar senha' : 'Nova senha'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
        <div className="flex justify-end gap-3">
          <EzButton type="button" variant="secondary" label="Cancelar" onClick={onClose} />
          <EzButton type="submit" variant="primary" label="Salvar" />
        </div>
      </form>
    </Modal>
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
    setRevealed(({ [key]: _hidden, ...rest }) => rest);
  };

  const hideAllFields = () => {
    generation.current += 1;
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current.clear();
    setRevealed({});
    setPending([]);
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
      if (startedAt !== generation.current) return;
      setRevealed((prev) => ({ ...prev, [key]: value ?? '' }));
      revealTimers.current.set(key, setTimeout(() => hideField(key), REVEAL_TTL_MS));
    } catch {
      if (startedAt === generation.current) showFeedback({ kind: 'error', text: SECRET_FIELDS[field].revealError });
    } finally {
      setPending((prev) => prev.filter((pendingKey) => pendingKey !== key));
    }
  };

  const handleSaveFolder = (name: string) => {
    if (folderModal?.folder) {
      updateFolderMutation.mutate({ id: folderModal.folder.id, name });
    } else {
      createFolderMutation.mutate(name);
    }
    setFolderModal(null);
  };

  const handleRemoveFolder = (folder: VaultFolder) => {
    if (!window.confirm(`Remover a pasta "${folder.name}"?`)) return;
    removeFolderMutation.mutate(folder.id, {
      onSuccess: () => {
        if (selectedFolderId === folder.id) setSelectedFolderId(ROOT_FOLDER_ID);
      },
    });
  };

  const handleSaveCredential = (dto: Partial<CredentialInput>) => {
    if (credentialModal?.credential) {
      updateCredentialMutation.mutate({ id: credentialModal.credential.id, ...dto });
    } else {
      createCredentialMutation.mutate(dto as CredentialInput);
    }
    hideAllFields();
    setCredentialModal(null);
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

  if (foldersQuery.isLoading || credentialsQuery.isLoading)
    return (
      <div className="flex justify-center p-8">
        <EzSpinner label="Carregando cofre..." />
      </div>
    );
  if (foldersQuery.isError || credentialsQuery.isError)
    return (
      <div className="p-8">
        <EzAlert variant="error">Erro ao carregar o cofre de senhas.</EzAlert>
      </div>
    );

  const credentials = credentialsQuery.data?.data ?? [];
  const meta = credentialsQuery.data?.meta;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Lock className="h-8 w-8" /> Cofre de Senhas
        </h1>
        {canEdit && (
          <EzButton
            variant="secondary"
            label="Auditoria"
            leftIcon={ShieldCheck}
            onClick={() => navigate('/vault/audit')}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
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
            <EzTextInput
              type="search"
              placeholder="Buscar senha..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              className="max-w-xs"
            />
            {canEdit && (
              <EzActionsButton
                label="Ações"
                actions={[
                  { label: 'Nova pasta', icon: <FolderPlus className="h-4 w-4" />, onClick: () => setFolderModal({}) },
                  { label: 'Nova senha', icon: <KeyRound className="h-4 w-4" />, onClick: () => setCredentialModal({}) },
                ]}
              />
            )}
          </div>

          {canEdit && selectedFolder && (
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-90/40 px-4 py-2 text-sm text-gray-600">
              <span>
                Pasta: <strong>{selectedFolder.name}</strong>
              </span>
              <div className="flex gap-2">
                <EzButton
                  variant="tertiary"
                  size="small"
                  leftIcon={Pencil}
                  title="Editar pasta"
                  aria-label={`Editar pasta ${selectedFolder.name}`}
                  onClick={() => setFolderModal({ folder: selectedFolder })}
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
            </div>
          )}

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
                          <span className="truncate max-w-[160px]">{cred.url}</span>
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
                            onClick={() => setCredentialModal({ credential: cred })}
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
          onSave={handleSaveFolder}
          onClose={() => setFolderModal(null)}
        />
      )}

      {credentialModal && (
        <CredentialModal
          credential={credentialModal.credential}
          folders={folders}
          defaultFolderId={selectedFolderId}
          onSave={handleSaveCredential}
          onClose={() => setCredentialModal(null)}
        />
      )}
    </div>
  );
}
