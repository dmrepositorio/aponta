import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ticket } from 'lucide-react';
import { EzButton } from './EzButton';

describe('EzButton', () => {
  it('renders the label correctly', () => {
    render(<EzButton label="Click Me" />);
    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('renders primary variant by default and applies brand color', () => {
    const { container } = render(<EzButton label="Defaults" />);
    // DS-01: brand-600 gives 4.64:1 with white text (WCAG 1.4.3); brand-500 gave 3.94:1.
    const button = container.firstChild as HTMLElement;
    expect(button).toHaveClass('bg-brand-600', 'border-brand-600', 'hover:bg-brand-700');
    expect(button).not.toHaveClass('bg-brand-500');
    expect(button.querySelector('span')).not.toHaveClass('font-normal');
  });

  it('renders secondary variant', () => {
    const { container } = render(<EzButton label="Outline" variant="secondary" />);
    expect(container.firstChild).toHaveClass('border-gray-200');
    expect(container.firstChild).toHaveClass('text-brand-600');
  });

  it('renders disabled state correctly', () => {
    const { container } = render(<EzButton label="Disabled" disabled />);
    expect(container.firstChild).toBeDisabled();
    expect(container.firstChild).toHaveClass('disabled:bg-gray-400');
  });

  it('renders as icon-only when label is omitted but icon is passed', () => {
    const { container } = render(<EzButton leftIcon={Ticket} aria-label="Abrir ticket" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    // No label rendered
    expect(container.textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Abrir ticket' })).toBeInTheDocument();
  });

  it('requires an accessible name when there is no label nor children (type-level, checked by tsc)', () => {
    // @ts-expect-error icon-only without aria-label/aria-labelledby must not compile
    const unnamed = <EzButton leftIcon={Ticket} />;
    expect(unnamed).toBeTruthy();
    expect(<EzButton leftIcon={Ticket} aria-labelledby="x" />).toBeTruthy();
  });

  it('uses the shared focus token instead of the brand-200 ring', () => {
    const { container } = render(<EzButton label="Foco" />);
    const button = container.firstChild as HTMLElement;
    expect(button).toHaveClass('ez-focus');
    expect(button.className).not.toContain('ring-brand-200');
    expect(button.className).not.toContain('ring-offset');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const stubReducedMotion = (reduce: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  describe('type padrão (DS-02)', () => {
    it('renders type="button" when no type is given', () => {
      render(<EzButton label="Sem tipo" />);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('keeps an explicit type="submit"', () => {
      render(<EzButton label="Enviar" type="submit" />);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('does not submit the surrounding form without an explicit type', () => {
      const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <EzButton label="Auxiliar" />
        </form>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Auxiliar' }));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits the surrounding form with type="submit"', () => {
      const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <EzButton label="Salvar" type="submit" />
        </form>
      );
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('loading (DS-04)', () => {
    it('sets aria-busy, disables the button and does not fire onClick', () => {
      const onClick = vi.fn();
      render(<EzButton label="Salvar" loading onClick={onClick} />);
      const button = screen.getByRole('button', { name: /Salvar/ });
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('shows a spinner only while loading', () => {
      const { container, rerender } = render(<EzButton label="Salvar" loading />);
      expect(container.querySelector('svg.animate-spin')).toBeInTheDocument();
      rerender(<EzButton label="Salvar" />);
      expect(container.querySelector('svg.animate-spin')).not.toBeInTheDocument();
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
    });
  });

  describe('disabledReason (DS-05)', () => {
    it('links the disabled button to a description element with the reason', () => {
      render(<EzButton label="Aprovar" disabled disabledReason="Falta preencher o cliente" />);
      const button = screen.getByRole('button', { name: 'Aprovar' });
      const describedBy = button.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)).toHaveTextContent(
        'Falta preencher o cliente'
      );
      expect(button).toHaveAttribute('title', 'Falta preencher o cliente');
    });

    it('ignores the reason while the button is enabled', () => {
      render(<EzButton label="Aprovar" disabledReason="Falta preencher o cliente" />);
      const button = screen.getByRole('button', { name: 'Aprovar' });
      expect(button).not.toHaveAttribute('aria-describedby');
      expect(button).not.toHaveAttribute('title');
    });

    it('uses a more legible text color for the disabled secondary variant', () => {
      render(<EzButton label="Buscar" variant="secondary" disabled />);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('disabled:text-gray-500');
      expect(button).not.toHaveClass('disabled:text-gray-400');
    });
  });

  describe('movimento reduzido (DS-06)', () => {
    it('adds a ripple span on click when motion is allowed', () => {
      stubReducedMotion(false);
      render(<EzButton label="Clique" />);
      const button = screen.getByRole('button');
      fireEvent.click(button);
      expect(button.querySelector('span.animate-ripple')).toBeInTheDocument();
    });

    it('does not add a ripple on click with prefers-reduced-motion: reduce, but still calls onClick', () => {
      stubReducedMotion(true);
      const onClick = vi.fn();
      render(<EzButton label="Clique" onClick={onClick} />);
      const button = screen.getByRole('button');
      fireEvent.click(button);
      expect(button.querySelector('span.animate-ripple')).not.toBeInTheDocument();
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('drops active:scale for reduced motion (motion-safe only)', () => {
      render(<EzButton label="Clique" />);
      const button = screen.getByRole('button');
      expect(button.className).not.toMatch(/(^|\s)active:scale-/);
      expect(button).toHaveClass('motion-safe:active:scale-[0.98]');
    });

    it('leaves no pending ripple timer after unmount', () => {
      stubReducedMotion(false);
      vi.useFakeTimers();
      const { unmount } = render(<EzButton label="Clique" />);
      fireEvent.click(screen.getByRole('button'));
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
