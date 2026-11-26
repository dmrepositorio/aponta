import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzDialog } from './EzDialog';

describe('EzDialog', () => {
  it('renders nothing when closed', () => {
    render(<EzDialog open={false} title="T" message="M" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.queryByText('T')).not.toBeInTheDocument();
  });

  it('close button has a 3:1 icon color and 44px/36px targets', () => {
    render(<EzDialog open title="T" message="M" onConfirm={() => undefined} onCancel={() => undefined} />);
    const btn = screen.getByLabelText('Fechar diálogo');
    expect(btn).toHaveClass('text-gray-600');
    expect(btn).not.toHaveClass('text-gray-400');
    expect(btn).toHaveClass('min-h-11');
    expect(btn).toHaveClass('min-w-11');
    expect(btn).toHaveClass('sm:min-h-9');
    expect(btn).toHaveClass('sm:min-w-9');
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<EzDialog open title="Excluir" message="Tem certeza?" onConfirm={onConfirm} onCancel={() => undefined} />);
    fireEvent.click(screen.getByText('Confirmar'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('applies danger icon color class', () => {
    render(
      <EzDialog open title="Excluir" message="M" variant="danger" onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(document.body.querySelector('svg')).toHaveClass('text-red-600');
  });

  it('renders children, custom labels and a disabled confirm, and keeps the defaults', () => {
    const { rerender } = render(
      <EzDialog open title="T" message="M" onConfirm={() => undefined} onCancel={() => undefined}>
        <ul><li>Contrato 1</li></ul>
      </EzDialog>
    );
    expect(screen.getByText('Contrato 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();

    rerender(
      <EzDialog
        open
        title="T"
        message="M"
        confirmLabel="Tentar novamente"
        cancelLabel="Fechar"
        confirmDisabled
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('focuses Cancelar when the danger dialog opens and names the dialog by its title', () => {
    render(
      <EzDialog open variant="danger" title="Excluir contrato" message="M" onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Excluir contrato' })).toBeInTheDocument();
  });

  describe('DS-18', () => {
    const noop = () => undefined;

    it('confirms with the destructive (red) button in the danger variant and keeps primary otherwise', () => {
      const { rerender } = render(<EzDialog open variant="danger" title="T" message="M" onConfirm={noop} onCancel={noop} />);
      expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveClass('bg-red-600');
      rerender(<EzDialog open variant="info" title="T" message="M" onConfirm={noop} onCancel={noop} />);
      expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveClass('bg-brand-600');
      expect(screen.getByRole('button', { name: 'Confirmar' })).not.toHaveClass('bg-red-600');
    });

    it('traps Tab and Shift+Tab inside the dialog', async () => {
      const user = userEvent.setup();
      render(
        <>
          <button>Fora</button>
          <EzDialog open variant="danger" title="T" message="M" onConfirm={noop} onCancel={noop} />
        </>,
      );
      expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Fechar diálogo' })).toHaveFocus();
      await user.tab({ shift: true });
      expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveFocus();
    });

    it('moves the focus into a non-danger dialog on open', () => {
      render(
        <>
          <button>Fora</button>
          <EzDialog open title="T" message="M" onConfirm={noop} onCancel={noop} />
        </>,
      );
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    });

    it('confirmLoading disables the confirm button, sets aria-busy and blocks a repeated onConfirm', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      render(<EzDialog open variant="danger" title="T" message="M" confirmLoading onConfirm={onConfirm} onCancel={noop} />);
      const confirm = screen.getByRole('button', { name: 'Confirmar' });
      expect(confirm).toBeDisabled();
      expect(confirm).toHaveAttribute('aria-busy', 'true');
      await user.dblClick(confirm);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('points aria-describedby at the message', () => {
      render(<EzDialog open title="Excluir" message="Esta ação é irreversível." onConfirm={noop} onCancel={noop} />);
      expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Esta ação é irreversível.');
    });

    it('locks the body scroll while open and releases it on close', () => {
      const { rerender } = render(<EzDialog open title="T" message="M" onConfirm={noop} onCancel={noop} />);
      expect(document.body.style.overflow).toBe('hidden');
      rerender(<EzDialog open={false} title="T" message="M" onConfirm={noop} onCancel={noop} />);
      expect(document.body.style.overflow).toBe('');
    });
  });
});
