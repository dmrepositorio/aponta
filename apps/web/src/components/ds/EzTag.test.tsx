import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Check } from 'lucide-react';
import { EzTag } from './EzTag';

describe('EzTag', () => {
  it('renders the label properly', () => {
    render(<EzTag label="New" />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders the default ocean variant', () => {
    const { container } = render(<EzTag label="Ocean" />);
    expect(container.firstChild).toHaveClass('bg-brand-100/50');
  });

  it('renders different variants correctly (e.g. red)', () => {
    const { container } = render(<EzTag label="Error" variant="red" />);
    expect(container.firstChild).toHaveClass('bg-red-100');
  });

  it('renders left and right icons when provided', () => {
    render(
      <EzTag 
        label="Done" 
        leftIcon={<Check data-testid="left-icon" />} 
        rightIcon={<span data-testid="right-icon">X</span>} 
      />
    );
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });
  it('renderiza como span quando não é clicável', () => {
    const { container } = render(<EzTag label="Aberto" />);
    expect(container.firstElementChild?.tagName).toBe('SPAN');
  });

  it('renderiza como button type=button quando recebe onClick', () => {
    const onClick = vi.fn();
    render(<EzTag label="Filtro" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Filtro' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['green', 'success'],
    ['yellow', 'warning'],
    ['red', 'danger'],
  ] as const)('variante %s mostra indicador de prefixo além da cor (WCAG 1.4.1)', (variant, kind) => {
    render(<EzTag label="Status" variant={variant} />);
    const indicator = screen.getByTestId('ez-tag-indicator');
    expect(indicator).toHaveAttribute('data-indicator', kind);
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
  });

  it.each(['ocean', 'gray', 'petroleum', 'outline'] as const)(
    'variante neutra %s não mostra indicador de severidade',
    (variant) => {
      render(<EzTag label="Neutra" variant={variant} />);
      expect(screen.queryByTestId('ez-tag-indicator')).not.toBeInTheDocument();
    }
  );

  it('leftIcon informado substitui o indicador de severidade', () => {
    render(<EzTag label="Erro" variant="red" leftIcon={<Check data-testid="left-icon" />} />);
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('ez-tag-indicator')).not.toBeInTheDocument();
  });
});
