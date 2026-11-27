import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeArticleCard, type KnowledgeArticleCardData } from './KnowledgeArticleCard';

const full: KnowledgeArticleCardData = {
  id: 'a-1',
  title: 'Artigo longo',
  content: '<p>Corpo completo do artigo</p>',
  visibility: 'PUBLIC',
  tags: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'],
  attachments: [
    {
      id: 'att-1',
      originalName: 'manual.pdf',
      mimeType: 'application/pdf',
      fileUrl: '/uploads/manual.pdf',
      createdAt: '2026-01-10T10:00:00.000Z',
    },
  ],
};

// O que o salvamento de uma edição entrega ao card: o mesmo artigo, sem nada escondido.
const emptied: KnowledgeArticleCardData = {
  ...full,
  content: '<p></p>',
  tags: ['t1'],
  attachments: [],
};

function renderCard(article: KnowledgeArticleCardData, access = { canAuthor: false, canDelete: false }) {
  const props = {
    selectedTags: [],
    onToggleTag: vi.fn(),
    canAuthor: access.canAuthor,
    canDelete: access.canDelete,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
  const queryClient = new QueryClient();
  const card = (a: KnowledgeArticleCardData) => (
    <QueryClientProvider client={queryClient}>
      <KnowledgeArticleCard article={a} {...props} />
    </QueryClientProvider>
  );
  const view = render(card(article));
  return { rerender: (next: KnowledgeArticleCardData) => view.rerender(card(next)) };
}

describe('KnowledgeArticleCard', () => {
  it('KNW-13: Editar e Excluir levam ícone e ficam afastados em 24px, sem trocar o nome acessível', () => {
    renderCard(full, { canAuthor: true, canDelete: true });
    const edit = screen.getByRole('button', { name: 'Editar' });
    const remove = screen.getByRole('button', { name: 'Excluir' });
    expect(edit.querySelector('svg')).not.toBeNull();
    expect(remove.querySelector('svg')).not.toBeNull();
    expect(edit.parentElement).toBe(remove.parentElement);
    expect(edit.parentElement).toHaveClass('gap-6');
  });

  it('collapses back when an update removes everything that was hidden, never staying expanded without the button', async () => {
    const user = userEvent.setup();
    const { rerender } = renderCard(full);
    await user.click(screen.getByRole('button', { name: /ler artigo completo/i }));
    expect(screen.getByText('Corpo completo do artigo')).toBeInTheDocument();

    rerender(emptied);

    expect(screen.queryByText('Corpo completo do artigo')).not.toBeInTheDocument();
    expect(document.querySelector('.article-content')).toBeNull();
    expect(screen.queryByRole('link', { name: /manual\.pdf/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recolher/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ler artigo completo/i })).not.toBeInTheDocument();
  });

  it('stays collapsed when the hidden content comes back after the update', async () => {
    const user = userEvent.setup();
    const { rerender } = renderCard(full);
    await user.click(screen.getByRole('button', { name: /ler artigo completo/i }));
    rerender(emptied);

    rerender(full);

    expect(screen.getByRole('button', { name: /ler artigo completo/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.querySelector('.article-content')).toBeNull();
  });
});
