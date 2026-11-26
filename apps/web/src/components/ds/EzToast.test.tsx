import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzToast } from './EzToast';

describe('EzToast', () => {
  it('renders title and defaults to info variant', () => {
    const { container } = render(<EzToast title="Network Connected" />);
    expect(screen.getByText('Network Connected')).toBeInTheDocument();
    // Defaults to visible
    expect(container.firstChild).toHaveClass('opacity-100');
    // Info variant defaults to text-brand-600
    expect(container.querySelector('.text-brand-600')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(<EzToast title="Title" description="Detailed message here" />);
    expect(screen.getByText('Detailed message here')).toBeInTheDocument();
  });

  it('renders error variant with correct color', () => {
    const { container } = render(<EzToast title="Error" variant="error" />);
    expect(container.querySelector('.text-red-600')).toBeInTheDocument();
  });

  it('applies enter/leave animations via visible prop', () => {
    const { container } = render(<EzToast title="Title" visible={false} />);
    expect(container.firstChild).toHaveClass('opacity-0');
    expect(container.firstChild).toHaveClass('scale-95');
  });

  it('fires onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const mockOnClose = vi.fn();
    render(<EzToast title="Alert" onClose={mockOnClose} />);
    
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('hides close button if onClose is omitted', () => {
    render(<EzToast title="Alert" />);
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  });

  it('exposes role=alert for error and warning variants', () => {
    const { rerender } = render(<EzToast title="Falha" variant="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha');
    rerender(<EzToast title="Atencao" variant="warning" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Atencao');
  });

  it('exposes role=status (polite) for info and success variants', () => {
    const { rerender } = render(<EzToast title="Info" />);
    expect(screen.getByRole('status')).toHaveTextContent('Info');
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<EzToast title="Ok" variant="success" />);
    expect(screen.getByRole('status')).toHaveTextContent('Ok');
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the role overridable by prop', () => {
    render(<EzToast title="Info" role="alert" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('gives the close button a 32px minimum target', () => {
    render(<EzToast title="Alert" onClose={() => undefined} />);
    const btn = screen.getByRole('button', { name: 'Fechar' });
    expect(btn).toHaveClass('min-h-8');
    expect(btn).toHaveClass('min-w-8');
  });
});
