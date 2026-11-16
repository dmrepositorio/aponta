import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EzEntityToolbar } from './EzEntityToolbar';

describe('EzEntityToolbar (Sankhya ERP Parity)', () => {
  it('renders all left and right buttons according to specification', () => {
    render(
      <EzEntityToolbar
        viewMode="GRID"
        onToggleViewMode={vi.fn()}
        onToggleFilter={vi.fn()}
        onInsert={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onDelete={vi.fn()}
        onClone={vi.fn()}
        onRefresh={vi.fn()}
        onOpenAttachments={vi.fn()}
        onOpenScreenConfig={vi.fn()}
        recordCountText="1 - 10 de 50"
      />
    );

    // Left buttons
    expect(screen.getByTestId('ez-toolbar-filter-panel-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-mode-toggle-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-mode-menu-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-insert-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-previous-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-next-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-delete-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-clone-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-refresh-button')).toBeInTheDocument();

    // Right buttons
    expect(screen.getByTestId('ez-toolbar-actions-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-attachments-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-screen-config-button')).toBeInTheDocument();
    expect(screen.getByTestId('ez-toolbar-record-count')).toHaveTextContent('1 - 10 de 50');
  });

  it('disables Delete and Clone buttons when selectedCount is 0, and enables when > 0', () => {
    const { rerender } = render(
      <EzEntityToolbar
        viewMode="GRID"
        onToggleViewMode={vi.fn()}
        onDelete={vi.fn()}
        onClone={vi.fn()}
        selectedCount={0}
      />
    );

    expect(screen.getByTestId('ez-toolbar-delete-button')).toBeDisabled();
    expect(screen.getByTestId('ez-toolbar-clone-button')).toBeDisabled();

    rerender(
      <EzEntityToolbar
        viewMode="GRID"
        onToggleViewMode={vi.fn()}
        onDelete={vi.fn()}
        onClone={vi.fn()}
        selectedCount={2}
      />
    );

    expect(screen.getByTestId('ez-toolbar-delete-button')).not.toBeDisabled();
    expect(screen.getByTestId('ez-toolbar-clone-button')).not.toBeDisabled();
  });

  it('toggles viewMode and opens mode configuration dropdown', async () => {
    const user = userEvent.setup();
    const onToggleViewMode = vi.fn();
    const onOpenGridConfig = vi.fn();
    const onOpenFormConfig = vi.fn();

    render(
      <EzEntityToolbar
        viewMode="GRID"
        onToggleViewMode={onToggleViewMode}
        onOpenGridConfig={onOpenGridConfig}
        onOpenFormConfig={onOpenFormConfig}
      />
    );

    // Clicking toggle button
    await user.click(screen.getByTestId('ez-toolbar-mode-toggle-button'));
    expect(onToggleViewMode).toHaveBeenCalledWith('FORM');

    // Clicking chevron opens dropdown
    await user.click(screen.getByTestId('ez-toolbar-mode-menu-button'));
    expect(screen.getByTestId('ez-toolbar-mode-dropdown')).toBeInTheDocument();

    // Pick "Configurar Grade..."
    await user.click(screen.getByTestId('ez-toolbar-open-grid-config'));
    expect(onOpenGridConfig).toHaveBeenCalled();
  });

  it('renders actions dropdown and fires action click', async () => {
    const user = userEvent.setup();
    const actionClick = vi.fn();

    render(
      <EzEntityToolbar
        viewMode="GRID"
        onToggleViewMode={vi.fn()}
        actions={[{ label: 'Exportar para Excel', onClick: actionClick }]}
      />
    );

    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    const item = screen.getByText('Exportar para Excel');
    expect(item).toBeInTheDocument();

    await user.click(item);
    expect(actionClick).toHaveBeenCalled();
  });
});

describe('EzEntityToolbar on phones (DMTE-541 AC-12)', () => {
  const fullToolbar = (
    <EzEntityToolbar
      viewMode="GRID"
      onToggleViewMode={vi.fn()}
      onToggleFilter={vi.fn()}
      onInsert={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onDelete={vi.fn()}
      onClone={vi.fn()}
      onRefresh={vi.fn()}
      onOpenAttachments={vi.fn()}
      onOpenScreenConfig={vi.fn()}
      actions={[{ label: 'Exportar', onClick: vi.fn() }]}
      recordCountText="1 - 10 de 50"
    />
  );

  it('scrolls in a single row below 640 px and wraps from 640 px up', () => {
    render(fullToolbar);
    const bar = screen.getByTestId('ez-entity-toolbar');
    expect(bar).toHaveClass('max-sm:flex-nowrap', 'max-sm:overflow-x-auto');
    for (const group of Array.from(bar.children)) {
      expect(group).toHaveClass('shrink-0');
    }
  });

  it('gives every toolbar button a 44 px minimum size below 640 px and keeps the current size from there', () => {
    render(fullToolbar);
    const buttons = within(screen.getByTestId('ez-entity-toolbar')).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(8);
    for (const button of buttons) {
      expect(button, button.getAttribute('data-testid') ?? button.textContent ?? '').toHaveClass(
        'max-sm:min-h-11',
        'max-sm:min-w-11',
      );
    }
  });

  it('opens its menus as a bottom sheet below 640 px so the scrolling row does not clip them', async () => {
    const user = userEvent.setup();
    render(fullToolbar);

    await user.click(screen.getByTestId('ez-toolbar-actions-button'));
    expect(screen.getByTestId('ez-toolbar-actions-dropdown')).toHaveClass('max-sm:fixed', 'max-sm:inset-x-3', 'max-sm:bottom-3');
    await user.click(screen.getByTestId('ez-toolbar-mode-menu-button'));
    expect(screen.getByTestId('ez-toolbar-mode-dropdown')).toHaveClass('max-sm:fixed', 'max-sm:inset-x-3', 'max-sm:bottom-3');
  });
});
