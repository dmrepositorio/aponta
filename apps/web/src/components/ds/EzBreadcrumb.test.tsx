import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzBreadcrumb } from './EzBreadcrumb';

describe('EzBreadcrumb', () => {
  it('renders a single text item properly', () => {
    const items = [{ label: 'Home' }];
    render(<EzBreadcrumb items={items} />);
    const item = screen.getByText('Home');
    expect(item).toBeInTheDocument();
    // It should be a span and not have href, but should have aria-current="page"
    expect(item.tagName).toBe('SPAN');
    expect(item).toHaveAttribute('aria-current', 'page');
  });

  it('renders a link item with href as anchor tag', () => {
    const items = [{ label: 'Home', href: '/home' }, { label: 'Settings' }];
    render(<EzBreadcrumb items={items} />);
    const link = screen.getByText('Home');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/home');
  });

  it('renders clickable item as button and fires onClick', async () => {
    const onClickMock = vi.fn();
    const items = [{ label: 'Back', onClick: onClickMock }, { label: 'Current' }];
    render(<EzBreadcrumb items={items} />);
    const btn = screen.getByText('Back');
    expect(btn.tagName).toBe('BUTTON');
    
    await userEvent.click(btn);
    expect(onClickMock).toHaveBeenCalledTimes(1);
  });

  it('sets aria-current="page" to the last item', () => {
    const items = [{ label: 'Root' }, { label: 'Parent' }, { label: 'Current' }];
    render(<EzBreadcrumb items={items} />);
    
    expect(screen.getByText('Root')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Parent')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Current')).toHaveAttribute('aria-current', 'page');
  });

  it('renders optional icons for items', () => {
    const items = [{ label: 'Home', icon: <svg data-testid="test-icon" /> }];
    render(<EzBreadcrumb items={items} />);
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });


  describe('acessibilidade e colapso (DS-25)', () => {
    const long = [
      { label: 'Raiz', href: '/r' },
      { label: 'Meio 1', href: '/m1' },
      { label: 'Meio 2', href: '/m2' },
      { label: 'Meio 3', href: '/m3' },
      { label: 'Atual' },
    ];

    it('names the nav in Portuguese', () => {
      render(<EzBreadcrumb items={[{ label: 'Home' }, { label: 'Atual' }]} />);
      expect(screen.getByRole('navigation', { name: 'Trilha de navegação' })).toBeInTheDocument();
    });

    it('renders onClick items as type=button', () => {
      render(<EzBreadcrumb items={[{ label: 'Voltar', onClick: vi.fn() }, { label: 'Atual' }]} />);
      expect(screen.getByRole('button', { name: 'Voltar' })).toHaveAttribute('type', 'button');
    });

    it('hides the chevron separators from assistive tech', () => {
      const { container } = render(<EzBreadcrumb items={[{ label: 'A', href: '/a' }, { label: 'B' }]} />);
      const chevron = container.querySelector('svg.lucide-chevron-right');
      expect(chevron).not.toBeNull();
      expect(chevron).toHaveAttribute('aria-hidden', 'true');
    });

    it('keeps the current item without pointer-events-none', () => {
      render(<EzBreadcrumb items={[{ label: 'A', href: '/a' }, { label: 'Atual' }]} />);
      const current = screen.getByText('Atual');
      expect(current).toHaveAttribute('aria-current', 'page');
      expect(current.className).not.toContain('pointer-events-none');
    });

    it('does not forward href to a span item', () => {
      render(<EzBreadcrumb items={[{ label: 'A', onClick: vi.fn() }, { label: 'Atual' }]} />);
      expect(screen.getByText('Atual')).not.toHaveAttribute('href');
    });

    it('collapses intermediate items of trails longer than 3 into an accessible ellipsis', () => {
      render(<EzBreadcrumb items={long} />);
      const toggle = screen.getByRole('button', { name: 'Mostrar itens intermediários' });
      expect(toggle).toHaveAttribute('type', 'button');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('Meio 2').closest('li')?.className).toContain('max-sm:hidden');
      expect(screen.getByText('Raiz').closest('li')?.className).not.toContain('max-sm:hidden');
      expect(screen.getByText('Atual').closest('li')?.className).not.toContain('max-sm:hidden');
    });

    it('expands the collapsed items when the ellipsis is activated', async () => {
      render(<EzBreadcrumb items={long} />);
      await userEvent.click(screen.getByRole('button', { name: 'Mostrar itens intermediários' }));
      expect(screen.queryByRole('button', { name: 'Mostrar itens intermediários' })).not.toBeInTheDocument();
      expect(screen.getByText('Meio 2').closest('li')?.className).not.toContain('max-sm:hidden');
    });

    it('does not collapse trails of up to 3 items', () => {
      render(<EzBreadcrumb items={long.slice(0, 3)} />);
      expect(screen.queryByRole('button', { name: 'Mostrar itens intermediários' })).not.toBeInTheDocument();
    });
  });
});
