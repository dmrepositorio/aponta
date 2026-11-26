import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { EzPagination } from './EzPagination';

describe('EzPagination', () => {
  it('renders correctly with given current and total pages', () => {
    render(<EzPagination currentPage={1} totalPages={5} onChange={vi.fn()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls onChange when a page number is clicked', async () => {
    const handleChange = vi.fn();
    render(<EzPagination currentPage={1} totalPages={5} onChange={handleChange} />);
    const page2 = screen.getByText('2');
    await userEvent.click(page2);
    expect(handleChange).toHaveBeenCalledWith(2);
  });

  it('calls onChange when "Next" arrow is clicked', async () => {
    const handleChange = vi.fn();
    render(<EzPagination currentPage={2} totalPages={5} onChange={handleChange} />);
    const buttons = screen.getAllByRole('button');
    const nextButton = buttons[buttons.length - 1]; // Next arrow
    await userEvent.click(nextButton);
    expect(handleChange).toHaveBeenCalledWith(3);
  });

  it('calls onChange when "Prev" arrow is clicked', async () => {
    const handleChange = vi.fn();
    render(<EzPagination currentPage={2} totalPages={5} onChange={handleChange} />);
    const prevButton = screen.getAllByRole('button')[0];
    await userEvent.click(prevButton);
    expect(handleChange).toHaveBeenCalledWith(1);
  });

  it('disables Prev arrow on first page', () => {
    render(<EzPagination currentPage={1} totalPages={5} onChange={vi.fn()} />);
    const prevButton = screen.getAllByRole('button')[0];
    expect(prevButton).toBeDisabled();
  });

  it('disables Next arrow on last page', () => {
    render(<EzPagination currentPage={5} totalPages={5} onChange={vi.fn()} />);
    const nextButton = screen.getAllByRole('button').at(-1);
    expect(nextButton).toBeDisabled();
  });

  describe('navegação acessível (DS-23)', () => {
    it('renders inside a nav landmark named Paginação', () => {
      render(<EzPagination currentPage={2} totalPages={5} onChange={vi.fn()} />);
      expect(screen.getByRole('navigation', { name: 'Paginação' })).toBeInTheDocument();
    });

    it('marks only the current page with aria-current and keeps it pointer-enabled', () => {
      render(<EzPagination currentPage={2} totalPages={5} onChange={vi.fn()} />);
      const current = screen.getByRole('button', { name: 'Página 2' });
      expect(current).toHaveAttribute('aria-current', 'page');
      expect(current.className).not.toContain('pointer-events-none');
      expect(screen.getByRole('button', { name: 'Página 3' })).not.toHaveAttribute('aria-current');
    });

    it('gives every button type=button, a PT aria-label, ez-focus and a 44px coarse-pointer target', () => {
      render(<EzPagination currentPage={2} totalPages={5} onChange={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Página anterior' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Próxima página' })).toBeInTheDocument();
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(2);
      for (const button of buttons) {
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveAttribute('aria-label');
        expect(button).toHaveClass('ez-focus');
        expect(button.className).toContain('[@media(pointer:coarse)]:min-h-11');
        expect(button.className).toContain('[@media(pointer:coarse)]:min-w-11');
      }
    });

    it('uses a hidden ellipsis character for omitted ranges', () => {
      render(<EzPagination currentPage={1} totalPages={20} onChange={vi.fn()} />);
      expect(screen.getByText('…')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByText('...')).not.toBeInTheDocument();
    });

    it('forwards the ref to the nav element', () => {
      const ref = { current: null as HTMLElement | null };
      render(<EzPagination ref={ref} currentPage={1} totalPages={3} onChange={vi.fn()} />);
      expect(ref.current?.tagName).toBe('NAV');
    });
  });

  describe('resumo de registros (DS-24)', () => {
    it('shows the visible range with totalItems and pageSize', () => {
      render(<EzPagination currentPage={1} totalPages={13} totalItems={312} pageSize={25} onChange={vi.fn()} />);
      expect(screen.getByText('Mostrando 1–25 de 312')).toBeInTheDocument();
    });

    it('clamps the last page range to the total', () => {
      render(<EzPagination currentPage={13} totalPages={13} totalItems={312} pageSize={25} onChange={vi.fn()} />);
      expect(screen.getByText('Mostrando 301–312 de 312')).toBeInTheDocument();
    });

    it('announces the summary politely', () => {
      render(<EzPagination currentPage={1} totalPages={13} totalItems={312} pageSize={25} onChange={vi.fn()} />);
      expect(screen.getByText('Mostrando 1–25 de 312')).toHaveAttribute('aria-live', 'polite');
    });

    it('still renders the summary with a single page when totalItems is given', () => {
      render(<EzPagination currentPage={1} totalPages={1} totalItems={7} pageSize={25} onChange={vi.fn()} />);
      expect(screen.getByText('Mostrando 1–7 de 7')).toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders nothing with a single page and no totalItems (behavior kept)', () => {
      const { container } = render(<EzPagination currentPage={1} totalPages={1} onChange={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('says Nenhum registro for an empty list', () => {
      render(<EzPagination currentPage={1} totalPages={1} totalItems={0} pageSize={25} onChange={vi.fn()} />);
      expect(screen.getByText('Nenhum registro')).toBeInTheDocument();
    });
  });
});
