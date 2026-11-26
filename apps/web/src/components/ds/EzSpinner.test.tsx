import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EzSpinner } from './EzSpinner';

describe('EzSpinner', () => {
  it('renders correctly with default size and classes', () => {
    const { container } = render(<EzSpinner />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveClass('text-brand-600');
  });

  it('respects custom size prop', () => {
    const { container } = render(<EzSpinner size={48} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '48');
  });

  it('applies custom color class to both spinner and label', () => {
    const { container } = render(<EzSpinner colorClass="text-red-500" label="Deleting..." />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('text-red-500');
    expect(screen.getByText('Deleting...')).toHaveClass('text-red-500');
  });

  it('names the status "Carregando" when there is no label', () => {
    render(<EzSpinner />);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeInTheDocument();
  });

  it('lets aria-label override the default name', () => {
    render(<EzSpinner aria-label="Salvando" />);
    expect(screen.getByRole('status', { name: 'Salvando' })).toBeInTheDocument();
  });

  it('hides the icon from assistive tech', () => {
    const { container } = render(<EzSpinner label="Carregando chamados" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status', { name: 'Carregando chamados' })).toBeInTheDocument();
  });

  it('renders a label if provided', () => {
    render(<EzSpinner label="Loading items..." />);
    expect(screen.getByText('Loading items...')).toBeInTheDocument();
  });
});
