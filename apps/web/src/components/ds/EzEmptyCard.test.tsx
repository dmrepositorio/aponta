import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Search } from 'lucide-react';
import { EzEmptyCard } from './EzEmptyCard';

describe('EzEmptyCard', () => {
  it('renders title and description', () => {
    render(<EzEmptyCard title="Nada encontrado" description="Tente outra busca" />);
    expect(screen.getByText('Nada encontrado')).toBeInTheDocument();
    expect(screen.getByText('Tente outra busca')).toBeInTheDocument();
  });

  it('renders custom icon when provided', () => {
    const { container } = render(<EzEmptyCard title="Vazio" icon={Search} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('hides the icon from assistive tech', () => {
    const { container } = render(<EzEmptyCard title="Vazio" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('error variant renders a retry button that calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<EzEmptyCard variant="error" title="Falha ao carregar" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('default variant has no retry button even if onRetry is given', () => {
    render(<EzEmptyCard title="Vazio" onRetry={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('renders action node', () => {
    render(<EzEmptyCard title="Vazio" action={<button>Recarregar</button>} />);
    expect(screen.getByText('Recarregar')).toBeInTheDocument();
  });
});
