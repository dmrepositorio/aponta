import { useMemo, useState } from 'react';
import { Check, Lock, Paperclip } from 'lucide-react';
import { EzButton, EzCardItem, EzTag } from '../ds';
import { cn } from '../ds/utils';
import { articleExcerpt } from './articleExcerpt';
import { KnowledgeArticleAttachments, type KnowledgeAttachment } from './KnowledgeArticleAttachments';
import { FOCUS_RING } from './knowledgeStyles';

const COLLAPSED_TAGS = 5;

export interface KnowledgeArticleCardData {
  id: string;
  title: string;
  content: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  tags: string[];
  author?: { id: string; name: string } | null;
  updatedAt?: string;
  attachments?: KnowledgeAttachment[];
}

interface KnowledgeArticleCardProps {
  article: KnowledgeArticleCardData;
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  canAuthor: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function formatUpdatedAt(value?: string) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('pt-BR');
}

/**
 * Card de artigo da base de Conhecimento: recolhido mostra título, meta, trecho,
 * até 5 tags e a contagem de anexos; expandido mostra o corpo, todas as tags e
 * os anexos (leitura). Upload e remoção de anexo ficam no formulário de edição.
 */
export function KnowledgeArticleCard({
  article,
  selectedTags,
  onToggleTag,
  canAuthor,
  canDelete,
  onEdit,
  onDelete,
}: KnowledgeArticleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const excerpt = useMemo(() => articleExcerpt(article.content), [article.content]);
  const attachments = article.attachments ?? [];
  const tags = article.tags ?? [];
  const hiddenTags = expanded ? 0 : Math.max(0, tags.length - COLLAPSED_TAGS);
  const visibleTags = expanded ? tags : tags.slice(0, COLLAPSED_TAGS);
  // Corpo só de marcação vazia (`<p></p>`) não esconde nada; imagem e tabela contam como conteúdo.
  const hasBody = excerpt !== '' || /<(img|table)\b/i.test(article.content);
  const hasHiddenContent = hasBody || attachments.length > 0 || tags.length > COLLAPSED_TAGS;
  const bodyId = `article-body-${article.id}`;
  const updatedAt = formatUpdatedAt(article.updatedAt);

  return (
    <article className="flex min-w-0">
      <EzCardItem flat className="min-w-0 gap-2 p-4">
        <div className="min-w-0">
          <h2 className="break-words text-[18px] font-semibold text-gray-900">{article.title}</h2>
        </div>

        {(article.visibility === 'PRIVATE' ||
          article.author?.name ||
          updatedAt ||
          attachments.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {article.visibility === 'PRIVATE' && <EzTag
                label="Interno"
                variant="petroleum"
                leftIcon={<Lock className="h-3 w-3" aria-hidden="true" />}
              />}
            {(article.author?.name || updatedAt) && (
              <p className="text-xs text-gray-500">
                {article.author?.name && <span>Por {article.author.name}</span>}
                {article.author?.name && updatedAt && <span> • </span>}
                {updatedAt && <span>{updatedAt}</span>}
              </p>
            )}
            {attachments.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {attachments.length} {attachments.length === 1 ? 'anexo' : 'anexos'}
                </span>
              </span>
            )}
          </div>
        )}

        {!expanded && excerpt && (
          <p className="line-clamp-3 break-words text-sm text-gray-700">{excerpt}</p>
        )}

        {expanded && (
          /*
            Safe to render raw: article content only ever reaches the
            client after passing through the backend's
            sanitizeArticleContent step on save (strict tag/attribute/
            inline-style allowlist) — this is never unsanitized HTML
            typed directly by the current user.
          */
          <div
            id={bodyId}
            className="article-content"
            dangerouslySetInnerHTML={{ __html: article.content }}
          />
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {visibleTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onToggleTag(t)}
                title={`Filtrar por ${t}`}
                aria-pressed={selectedTags.includes(t)}
                className={cn('rounded-full', FOCUS_RING)}
              >
                <EzTag
                  label={`#${t}`}
                  variant={selectedTags.includes(t) ? 'ocean' : 'gray'}
                  leftIcon={
                    selectedTags.includes(t) ? <Check className="h-3 w-3" aria-hidden="true" /> : undefined
                  }
                />
              </button>
            ))}
            {hiddenTags > 0 && <EzTag label={`+${hiddenTags}`} variant="gray" />}
          </div>
        )}

        {expanded && attachments.length > 0 && (
          <KnowledgeArticleAttachments
            articleId={article.id}
            attachments={attachments}
            canManage={false}
          />
        )}

        {(hasHiddenContent || canAuthor) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            {hasHiddenContent && (
              <EzButton
                type="button"
                variant="tertiary"
                size="small"
                className="px-0"
                aria-expanded={expanded}
                aria-controls={expanded ? bodyId : undefined}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? 'Recolher' : 'Ler artigo completo'}
              </EzButton>
            )}
            {canAuthor && (
              <div className="ml-auto flex flex-wrap gap-4">
                <EzButton variant="tertiary" size="small" className="px-0" onClick={onEdit}>
                  Editar
                </EzButton>
                {canDelete && (
                  <EzButton
                    variant="tertiary"
                    size="small"
                    className="px-0 text-red-600 hover:text-red-700"
                    onClick={onDelete}
                  >
                    Excluir
                  </EzButton>
                )}
              </div>
            )}
          </div>
        )}
      </EzCardItem>
    </article>
  );
}
