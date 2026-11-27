import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Check, LayoutGrid, List as ListIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import {
  EzAlert,
  EzBreadcrumb,
  EzButton,
  EzCardItem,
  EzCheck,
  EzComboBox,
  EzDialog,
  EzEmptyCard,
  EzModal,
  EzMultiSelect,
  EzPageHeader,
  EzPageLayout,
  EzPagination,
  EzRichText,
  EzSpinner,
  EzTag,
  EzTagInput,
  EzTextInput,
  EzToast,
} from '../components/ds';
import { cn } from '../components/ds/utils';
import { KnowledgeFolder, KnowledgeFoldersGrid } from '../components/knowledge/KnowledgeFoldersGrid';
import {
  KnowledgeArticleAttachments,
  type KnowledgeAttachment,
} from '../components/knowledge/KnowledgeArticleAttachments';
import { KnowledgeArticleCard } from '../components/knowledge/KnowledgeArticleCard';
import { knowledgeApiError } from '../components/knowledge/knowledgeApiError';
import { FOCUS_RING } from '../components/knowledge/knowledgeStyles';

type ArticleVisibility = 'PUBLIC' | 'PRIVATE';

interface Article {
  id: string;
  title: string;
  content: string;
  visibility: ArticleVisibility;
  autoShareWithNewOrganizations?: boolean;
  tags: string[];
  author?: { id: string; name: string } | null;
  updatedAt?: string;
  attachments?: KnowledgeAttachment[];
  allowedAgentGroups?: { id: string; name: string }[];
  allowedOrganizations?: { id: string; name: string }[];
  serviceCatalogItems?: { id: string; name: string }[];
}

interface OrganizationAgentGroup {
  id: string;
  name: string;
  active: boolean;
}

interface OrganizationWithAgentGroups {
  id: string;
  name: string;
  agentGroups?: OrganizationAgentGroup[];
}

interface ServiceCatalogItem {
  id: string;
  name: string;
  description?: string | null;
}

type ArticleSort = 'updated_desc' | 'title_asc' | 'title_desc';
type ViewMode = 'list' | 'grid';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;
const NOTICE_MS = 5000;

const SORT_VALUES: ArticleSort[] = ['updated_desc', 'title_asc', 'title_desc'];

/** "1 grupo, 2 clientes": resumo do compartilhamento escolhido (vazio quando nada foi escolhido). */
function sharingSummary(groupCount: number, organizationCount: number): string {
  const parts: string[] = [];
  if (groupCount > 0) parts.push(`${groupCount} ${groupCount === 1 ? 'grupo' : 'grupos'}`);
  if (organizationCount > 0) {
    parts.push(`${organizationCount} ${organizationCount === 1 ? 'cliente' : 'clientes'}`);
  }
  return parts.join(', ');
}

export function KnowledgePage() {
  const user = useAuthStore((state) => state.user);
  const canAuthor =
    user?.role === 'AGENT' ||
    user?.role === 'AGENT_MASTER' ||
    user?.role === 'ADMIN';

  const canDelete = user?.role === 'ADMIN';

  const queryClient = useQueryClient();
  // KNW-03: pasta aberta, busca, tags, ordenação, modo e página moram na URL
  // (?folder, q, tags, sort, view, page): recarregar ou voltar restaura o estado
  // e pasta/busca viram link compartilhável. Valores padrão ficam fora da URL.
  // Sem ?folder = grade de pastas (DMTE-87, Stage 1).
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFolderId = searchParams.get('folder') || null;
  const search = searchParams.get('q') ?? '';
  const tagsParam = searchParams.get('tags') ?? '';
  const selectedTags = useMemo(() => tagsParam.split(',').filter(Boolean), [tagsParam]);
  const sortParam = searchParams.get('sort');
  const sort: ArticleSort = SORT_VALUES.includes(sortParam as ArticleSort)
    ? (sortParam as ArticleSort)
    : 'updated_desc';
  const viewMode: ViewMode = searchParams.get('view') === 'grid' ? 'grid' : 'list';
  const pageParam = Number.parseInt(searchParams.get('page') ?? '', 10);
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;

  /** Aplica as mudanças à URL; null/'' remove a chave. `push` abre uma entrada no histórico (pasta). */
  const updateParams = useCallback(
    (patch: Record<string, string | null>, push = false) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: !push },
      );
    },
    [setSearchParams],
  );

  const CLEAR_VIEW_STATE = { q: null, tags: null, sort: null, view: null, page: null };
  const openFolder = (id: string) => updateParams({ folder: id, ...CLEAR_VIEW_STATE }, true);
  const closeFolder = () => updateParams({ folder: null, ...CLEAR_VIEW_STATE }, true);

  // KNW-04: o campo é local (digitação sem atraso) e a busca só vai à URL, e
  // portanto à API, 300 ms depois da última tecla.
  const [searchText, setSearchText] = useState(search);
  useEffect(() => {
    setSearchText(search);
  }, [search]);
  useEffect(() => {
    if (searchText === search) return undefined;
    const timer = setTimeout(
      () => updateParams({ q: searchText, page: null }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const setSort = (value: ArticleSort) =>
    updateParams({ sort: value === 'updated_desc' ? null : value, page: null });
  const setViewMode = (value: ViewMode) => updateParams({ view: value === 'grid' ? 'grid' : null });
  const setPage = (value: number) => updateParams({ page: value > 1 ? String(value) : null });
  // KNW-05: ao trocar de página a lista volta ao topo; sem animação com prefers-reduced-motion.
  const changePage = (value: number) => {
    setPage(value);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    listTopRef.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const listTopRef = useRef<HTMLParagraphElement>(null);
  const [articleToDelete, setArticleToDelete] = useState<Article | null>(null);

  // Reutiliza a mesma queryKey da KnowledgeFoldersGrid para ler o nome da
  // pasta selecionada (breadcrumb) a partir do cache já populado por ela,
  // sem disparar uma segunda requisição.
  const { data: folders, isFetching: foldersFetching } = useQuery<KnowledgeFolder[]>({
    queryKey: ['knowledge-folders'],
    queryFn: async () => {
      const res = await api.get('/knowledge-folders');
      return res.data;
    },
    enabled: selectedFolderId !== null,
  });
  const selectedFolder = folders?.find((f) => f.id === selectedFolderId);

  // Pasta inexistente ou sem acesso na URL: cai na grade (a lista de pastas já
  // vem filtrada pelo que o usuário pode ver).
  useEffect(() => {
    if (selectedFolderId && folders && !foldersFetching && !selectedFolder) {
      updateParams({ folder: null, ...CLEAR_VIEW_STATE });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolderId, folders, foldersFetching, selectedFolder]);

  const fetchArticles = async (filters: { search: string; tags: string[]; sort: ArticleSort }) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.tags.length > 0) params.set('tags', filters.tags.join(','));
    if (filters.sort !== 'updated_desc') params.set('sort', filters.sort);
    if (selectedFolderId) params.set('folderId', selectedFolderId);

    // Even if user not logged in, api.get works for public articles.
    const res = await api.get(`/articles?${params.toString()}`);
    return res.data as Article[];
  };

  const { data: articles, isLoading, isError, isPlaceholderData, refetch } = useQuery<Article[]>({
    queryKey: ['articles', { search, tags: selectedTags, sort, folderId: selectedFolderId }],
    queryFn: () => fetchArticles({ search, tags: selectedTags, sort }),
    enabled: selectedFolderId !== null,
    // KNW-04: a lista anterior fica na tela enquanto a nova carrega, mas só a da
    // mesma pasta (outra pasta mostraria artigos que não são dela).
    placeholderData: (previous, previousQuery) => {
      const previousFolder = (previousQuery?.queryKey[1] as { folderId?: string | null } | undefined)?.folderId;
      return previousFolder === selectedFolderId ? keepPreviousData(previous) : undefined;
    },
  });

  // KNW-07: as tags já usadas na pasta alimentam as sugestões do formulário e a
  // lista de filtro. Vêm da lista sem filtro (mesma chave da lista principal
  // quando não há filtro, então sem requisição extra) para que filtrar não
  // esconda as demais tags; não há endpoint de tags.
  const { data: folderArticles } = useQuery<Article[]>({
    queryKey: ['articles', { search: '', tags: [], sort: 'updated_desc', folderId: selectedFolderId }],
    queryFn: () => fetchArticles({ search: '', tags: [], sort: 'updated_desc' }),
    enabled: selectedFolderId !== null,
  });
  const knownTags = useMemo(() => {
    const unique = new Set<string>();
    for (const art of folderArticles ?? []) for (const tag of art.tags ?? []) unique.add(tag);
    for (const tag of selectedTags) unique.add(tag);
    return [...unique].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [folderArticles, selectedTags]);

  // Fontes para o diálogo de compartilhamento e para o multi-select de
  // Catálogo de Serviços — só necessárias para quem pode autorar artigos.
  const { data: organizations } = useQuery<OrganizationWithAgentGroups[]>({
    queryKey: ['organizations-for-knowledge-sharing'],
    queryFn: async () => {
      const res = await api.get('/organizations');
      return res.data;
    },
    enabled: canAuthor && selectedFolderId !== null,
  });

  const { data: catalogItems } = useQuery<ServiceCatalogItem[]>({
    queryKey: ['service-catalog-items'],
    queryFn: async () => {
      const res = await api.get('/service-catalog-items');
      return res.data;
    },
    enabled: canAuthor && selectedFolderId !== null,
  });

  const agentGroupOptions = useMemo(
    () =>
      (organizations ?? []).flatMap((org) =>
        (org.agentGroups ?? []).map((group) => ({
          value: group.id,
          label: `${org.name} / ${group.name}`,
        }))
      ),
    [organizations]
  );

  const organizationOptions = useMemo(
    () => (organizations ?? []).map((org) => ({ value: org.id, label: org.name })),
    [organizations]
  );

  const catalogItemOptions = useMemo(
    () => (catalogItems ?? []).map((item) => ({ value: item.id, label: item.name })),
    [catalogItems]
  );

  const hasCachedList = !!articles?.length;
  const totalArticles = articles?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalArticles / PAGE_SIZE));
  // Uma página além do fim (link antigo, artigo excluído) mostra a última.
  const currentPage = Math.min(page, totalPages);
  const pagedArticles = useMemo(
    () => (articles ?? []).slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [articles, currentPage]
  );

  const hasFilters = search !== '' || selectedTags.length > 0;
  const clearFilters = () => {
    setSearchText('');
    updateParams({ q: null, tags: null, page: null });
    searchRef.current?.focus();
  };

  // Tiflux-parity: filtro por múltiplas tags reinicia a paginação.
  const toggleTag = (t: string) => {
    const next = selectedTags.includes(t) ? selectedTags.filter((x) => x !== t) : [...selectedTags, t];
    updateParams({ tags: next.join(','), page: null });
  };

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<ArticleVisibility>('PUBLIC');
  const [formTags, setFormTags] = useState<string[]>([]);
  const [agentGroupIds, setAgentGroupIds] = useState<string[]>([]);
  const [organizationIds, setOrganizationIds] = useState<string[]>([]);
  const [autoShareWithNewOrganizations, setAutoShareWithNewOrganizations] = useState(false);
  const [serviceCatalogItemIds, setServiceCatalogItemIds] = useState<string[]>([]);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Formulário simples (nome + descrição) para cadastrar um novo item de
  // catálogo sem sair da página de Conhecimentos, suficiente para popular o
  // multi-select (a tela de administração completa do catálogo não faz
  // parte desta issue).
  const [isNewCatalogItemFormOpen, setIsNewCatalogItemFormOpen] = useState(false);
  const [newCatalogItemName, setNewCatalogItemName] = useState('');
  const [newCatalogItemDescription, setNewCatalogItemDescription] = useState('');

  const createCatalogItemMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/service-catalog-items', {
        name: newCatalogItemName,
        description: newCatalogItemDescription || undefined,
      });
      return res.data as ServiceCatalogItem;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['service-catalog-items'] });
      setServiceCatalogItemIds((prev) => [...prev, created.id]);
      setNewCatalogItemName('');
      setNewCatalogItemDescription('');
      setIsNewCatalogItemFormOpen(false);
    },
  });

  // Título e conteúdo de quando o formulário abriu: base do "Cancelar" com confirmação.
  const initialForm = useRef({ title: '', content: '' });
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!savedNotice) return undefined;
    const timer = setTimeout(() => setSavedNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  const openNewForm = () => {
    initialForm.current = { title: '', content: '' };
    saveMutation.reset();
    setEditingId(null);
    setTitle('');
    setContent('');
    setVisibility('PUBLIC');
    setFormTags([]);
    setAgentGroupIds([]);
    setOrganizationIds([]);
    setAutoShareWithNewOrganizations(false);
    setServiceCatalogItemIds([]);
    setIsFormOpen(true);
  };

  const openEditForm = (art: Article) => {
    initialForm.current = { title: art.title, content: art.content };
    saveMutation.reset();
    setEditingId(art.id);
    setTitle(art.title);
    setContent(art.content);
    setVisibility(art.visibility);
    setFormTags(art.tags ?? []);
    setAgentGroupIds((art.allowedAgentGroups ?? []).map((g) => g.id));
    setOrganizationIds((art.allowedOrganizations ?? []).map((o) => o.id));
    setAutoShareWithNewOrganizations(art.autoShareWithNewOrganizations ?? false);
    setServiceCatalogItemIds((art.serviceCatalogItems ?? []).map((c) => c.id));
    setIsFormOpen(true);
  };

  // O formulário abre inline e empurra a lista: o foco vai ao título. Ao editar,
  // o formulário entra na vista (KNW-11): sem animação com prefers-reduced-motion.
  useEffect(() => {
    if (!isFormOpen) return;
    titleRef.current?.focus({ preventScroll: editingId !== null });
    if (editingId !== null) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      formRef.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }, [isFormOpen, editingId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: {
        title: string;
        content: string;
        visibility: ArticleVisibility;
        tags: string[];
        folderId?: string;
        agentGroupIds: string[];
        organizationIds: string[];
        autoShareWithNewOrganizations: boolean;
        serviceCatalogItemIds: string[];
      } = {
        title,
        content,
        visibility,
        tags: formTags,
        // KNW-06: só Privado compartilha; Público não carrega listas antigas.
        agentGroupIds: visibility === 'PRIVATE' ? agentGroupIds : [],
        organizationIds: visibility === 'PRIVATE' ? organizationIds : [],
        autoShareWithNewOrganizations: visibility === 'PRIVATE' ? autoShareWithNewOrganizations : false,
        serviceCatalogItemIds,
      };

      // Um artigo criado dentro de uma pasta já nasce associado a ela.
      if (!editingId && selectedFolderId) {
        payload.folderId = selectedFolderId;
      }

      if (editingId) {
        return api.patch(`/articles/${editingId}`, payload).then((r) => r.data);
      }
      return api.post('/articles', payload).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      setSavedNotice(editingId ? 'Artigo atualizado.' : 'Artigo salvo.');
      setIsFormOpen(false);
    },
  });

  const isFormDirty = title !== initialForm.current.title || content !== initialForm.current.content;
  const cancelForm = () => {
    if (isFormDirty) {
      setIsDiscardOpen(true);
      return;
    }
    setIsFormOpen(false);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/articles/${id}`);
    },
  });

  if (selectedFolderId === null) {
    // A grade de pastas monta o próprio EzPageLayout/EzPageHeader.
    return <KnowledgeFoldersGrid onOpenFolder={openFolder} canAuthor={canAuthor} />;
  }

  return (
    <EzPageLayout
      header={
        <EzPageHeader
          title="Base de Conhecimento (FAQ)"
          breadcrumbs={
            <EzBreadcrumb
              items={[
                { label: 'Pastas', onClick: closeFolder },
                { label: selectedFolder?.name ?? '...' },
              ]}
            />
          }
          actions={
            <>
              <EzTextInput
                ref={searchRef}
                type="search"
                placeholder="Buscar palavra-chave..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                title="busca por palavra-chave"
                className="w-40 sm:w-[280px]"
              />
              {canAuthor && (
                <EzButton
                  type="button"
                  onClick={openNewForm}
                  disabled={isFormOpen}
                  title={isFormOpen ? 'O formulário de artigo já está aberto.' : undefined}
                  className="shrink-0"
                >
                  + Novo artigo
                </EzButton>
              )}
            </>
          }
        />
      }
    >
      {!user && <p className="mb-4 text-sm text-gray-500">Exibindo apenas artigos públicos</p>}

      {knownTags.length > 0 && (
        <div role="group" aria-label="Filtrar por tag" className="mb-4 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
          {knownTags.map((t) => {
            const active = selectedTags.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                aria-pressed={active}
                className={cn('rounded-full', FOCUS_RING)}
              >
                <EzTag
                  label={t}
                  variant={active ? 'ocean' : 'gray'}
                  leftIcon={active ? <Check className="h-3 w-3" aria-hidden="true" /> : undefined}
                />
              </button>
            );
          })}
        </div>
      )}

      {selectedTags.length > 0 && (
        <div data-testid="knowledge-active-filters" className="mb-4 flex flex-wrap items-center gap-2">
          {selectedTags.map((t) => (
            <EzTag
              key={t}
              label={`Tag: ${t}`}
              variant="ocean"
              className="whitespace-nowrap"
              rightIcon={
                <button
                  type="button"
                  onClick={() => toggleTag(t)}
                  aria-label={`Remover filtro de tag ${t}`}
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-full font-bold hover:bg-black/10',
                    FOCUS_RING
                  )}
                >
                  &times;
                </button>
              }
            />
          ))}
        </div>
      )}

      {canAuthor && isFormOpen && (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
          className="mb-6"
        >
          <EzCardItem flat className="p-4 space-y-3">
            <EzTextInput
              ref={titleRef}
              id="article-title"
              label="Título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <EzRichText
              value={content}
              onChange={setContent}
              label="Conteúdo"
              testId="article-content-editor"
            />
            <EzTagInput
              id="article-tags"
              label="Tags"
              tags={formTags}
              onChange={setFormTags}
              suggestions={knownTags}
              addOnBlur
              placeholder="Digite e pressione Enter. Ex: acesso, senha, rh"
            />
            {editingId && (
              <KnowledgeArticleAttachments
                articleId={editingId}
                attachments={articles?.find((a) => a.id === editingId)?.attachments ?? []}
                canManage
              />
            )}

            <div className="flex items-end gap-3">
              <div className="w-[220px]">
                <EzComboBox
                  id="article-visibility"
                  label="Tipo de acesso"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as ArticleVisibility)}
                >
                  <option value="PUBLIC">Público</option>
                  <option value="PRIVATE">Privado</option>
                </EzComboBox>
              </div>
              {visibility === 'PRIVATE' && (
                <>
                  <EzButton
                    type="button"
                    variant="secondary"
                    onClick={() => setIsShareModalOpen(true)}
                  >
                    Compartilhar
                  </EzButton>
                  {sharingSummary(agentGroupIds.length, organizationIds.length) && (
                    <EzTag
                      variant="gray"
                      label={sharingSummary(agentGroupIds.length, organizationIds.length)}
                      className="mb-2"
                    />
                  )}
                </>
              )}
            </div>

            <EzMultiSelect
              id="article-service-catalog-items"
              label="Catálogo de serviços"
              value={serviceCatalogItemIds}
              onChange={(values) => setServiceCatalogItemIds(values as string[])}
              options={catalogItemOptions}
              placeholder="Associar itens do catálogo de serviços..."
            />

            {!isNewCatalogItemFormOpen ? (
              <EzButton
                type="button"
                variant="tertiary"
                size="small"
                className="self-start px-0"
                onClick={() => setIsNewCatalogItemFormOpen(true)}
              >
                + Novo item de catálogo
              </EzButton>
            ) : (
              <EzCardItem flat className="p-3 space-y-2 bg-gray-90/40">
                <EzTextInput
                  id="new-catalog-item-name"
                  label="Nome do item de catálogo"
                  value={newCatalogItemName}
                  onChange={(e) => setNewCatalogItemName(e.target.value)}
                />
                <EzTextInput
                  id="new-catalog-item-description"
                  label="Descrição (opcional)"
                  value={newCatalogItemDescription}
                  onChange={(e) => setNewCatalogItemDescription(e.target.value)}
                />
                <div className="flex gap-2">
                  <EzButton
                    type="button"
                    size="small"
                    disabled={!newCatalogItemName.trim() || createCatalogItemMutation.isPending}
                    onClick={() => createCatalogItemMutation.mutate()}
                  >
                    Adicionar
                  </EzButton>
                  <EzButton
                    type="button"
                    variant="tertiary"
                    size="small"
                    onClick={() => setIsNewCatalogItemFormOpen(false)}
                  >
                    Cancelar
                  </EzButton>
                </div>
              </EzCardItem>
            )}

            {saveMutation.isError && (
              <EzAlert variant="error">
                Falha ao {editingId ? 'atualizar' : 'salvar'} o artigo.
                {(() => {
                  const reason = knowledgeApiError(saveMutation.error, '');
                  return reason ? ` ${reason}` : null;
                })()}
              </EzAlert>
            )}
            <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex gap-2 rounded-b-[inherit] border-t border-gray-200 bg-white px-4 py-3">
              <EzButton type="submit" disabled={saveMutation.isPending}>
                {editingId ? 'Atualizar' : 'Salvar'}
              </EzButton>
              <EzButton type="button" variant="secondary" onClick={cancelForm}>
                Cancelar
              </EzButton>
            </div>
          </EzCardItem>
        </form>
      )}

      <EzModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        title="Compartilhar artigo"
        maxWidth="md"
        footer={
          <EzButton type="button" onClick={() => setIsShareModalOpen(false)}>
            Concluído
          </EzButton>
        }
      >
        <div className="space-y-4">
          <EzMultiSelect
            id="article-agent-groups"
            label="Grupos de atendentes"
            value={agentGroupIds}
            onChange={(values) => setAgentGroupIds(values as string[])}
            options={agentGroupOptions}
            placeholder="Selecione os grupos de atendentes..."
          />
          <EzMultiSelect
            id="article-organizations"
            label="Clientes"
            value={organizationIds}
            onChange={(values) => setOrganizationIds(values as string[])}
            options={organizationOptions}
            placeholder="Selecione os clientes..."
          />
          <EzCheck
            id="article-auto-share"
            label="Adicionar novos clientes automaticamente"
            checked={autoShareWithNewOrganizations}
            onChange={(e) => setAutoShareWithNewOrganizations(e.target.checked)}
          />
        </div>
      </EzModal>

      {/* Tiflux-parity: ordenação (A-Z/Z-A/última atualização) e alternador Lista/Grade */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="w-[220px]">
          <EzComboBox
            id="article-sort"
            aria-label="Ordenar por"
            value={sort}
            onChange={(e) => setSort(e.target.value as ArticleSort)}
          >
            <option value="updated_desc">Última atualização</option>
            <option value="title_asc">A - Z</option>
            <option value="title_desc">Z - A</option>
          </EzComboBox>
        </div>

        <div className="flex h-[var(--control-height-md)] shrink-0 items-center gap-1 rounded-control border border-gray-200 p-1">
          <button
            type="button"
            aria-label="Exibir em lista"
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
              FOCUS_RING,
              viewMode === 'list' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-90'
            )}
          >
            <ListIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Exibir em grade"
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
              FOCUS_RING,
              viewMode === 'grid' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:bg-gray-90'
            )}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* DMTE-537: o carregamento fica na área da lista; o cabeçalho (busca,
          ordenação, tags) continua montado para não perder foco nem teclas. */}
      {isLoading && (
        <div className="flex justify-center p-4">
          <EzSpinner label="Carregando artigos..." />
        </div>
      )}
      {isError && !isLoading && hasCachedList && (
        <EzAlert
          variant="warning"
          action={
            <EzButton type="button" variant="secondary" size="small" onClick={() => void refetch()}>
              Tentar novamente
            </EzButton>
          }
        >
          Não foi possível atualizar os artigos. A lista abaixo pode estar desatualizada.
        </EzAlert>
      )}
      <p ref={listTopRef} aria-live="polite" className="text-[14px] text-gray-500">
        {totalArticles > 0 ? `${totalArticles} ${totalArticles === 1 ? 'artigo' : 'artigos'}` : ''}
      </p>
      <div
        data-testid="knowledge-articles"
        data-view-mode={viewMode}
        aria-busy={isPlaceholderData || undefined}
        className={
          viewMode === 'grid'
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
            : 'space-y-4'
        }
      >
        {pagedArticles.map((art) => (
          <KnowledgeArticleCard
            key={art.id}
            article={art}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            canAuthor={canAuthor}
            canDelete={canDelete}
            onEdit={() => openEditForm(art)}
            onDelete={() => {
              deleteMutation.reset();
              setArticleToDelete(art);
            }}
          />
        ))}
      </div>

      {isError && !isLoading && !hasCachedList && (
        <div className="flex flex-col items-start gap-3">
          <EzAlert variant="error">Não foi possível carregar os artigos.</EzAlert>
          <EzButton type="button" variant="secondary" size="small" onClick={() => void refetch()}>
            Tentar novamente
          </EzButton>
        </div>
      )}
      {!isLoading && !isError && !articles?.length && (
        hasFilters ? (
          <EzEmptyCard
            title="Nenhum artigo encontrado para a busca atual."
            action={
              <EzButton type="button" variant="secondary" size="small" onClick={clearFilters}>
                Limpar busca e filtros
              </EzButton>
            }
          />
        ) : (
          <EzEmptyCard
            title="Esta pasta ainda não tem artigos."
            description={canAuthor ? undefined : 'Quando houver artigos, eles aparecem aqui.'}
            action={
              canAuthor && !isFormOpen ? (
                <EzButton type="button" size="small" onClick={openNewForm}>
                  + Novo artigo
                </EzButton>
              ) : undefined
            }
          />
        )
      )}

      <EzDialog
        open={articleToDelete !== null}
        variant="danger"
        title="Excluir artigo"
        message={`Excluir o artigo "${articleToDelete?.title ?? ''}"?`}
        confirmLoading={deleteMutation.isPending}
        onCancel={() => {
          setArticleToDelete(null);
          deleteMutation.reset();
        }}
        onConfirm={() => {
          if (!articleToDelete || deleteMutation.isPending) return;
          // KNW-01: o diálogo fecha só no sucesso; a recusa da API aparece nele.
          deleteMutation.mutate(articleToDelete.id, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ['articles'] });
              setArticleToDelete(null);
            },
          });
        }}
      >
        {deleteMutation.isError && (
          <EzAlert variant="error" className="mt-3">
            {knowledgeApiError(deleteMutation.error, 'Não foi possível excluir o artigo.')}
          </EzAlert>
        )}
      </EzDialog>

      <EzDialog
        open={isDiscardOpen}
        variant="warning"
        title="Descartar alterações?"
        message="O título e o conteúdo alterados serão perdidos."
        confirmLabel="Descartar"
        cancelLabel="Continuar editando"
        onCancel={() => setIsDiscardOpen(false)}
        onConfirm={() => {
          setIsDiscardOpen(false);
          setIsFormOpen(false);
        }}
      />

      {savedNotice && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 w-[calc(100%-2rem)] max-w-sm">
          <div>
            <EzToast variant="success" title={savedNotice} onClose={() => setSavedNotice(null)} />
          </div>
        </div>
      )}

      <EzPagination
        currentPage={currentPage}
        totalPages={totalPages}
        onChange={changePage}
        className="mt-6 justify-center"
      />
    </EzPageLayout>
  );
}

export default KnowledgePage;
