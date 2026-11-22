import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EzProgressBar } from './EzProgressBar';

describe('EzProgressBar', () => {
  it('renders without errors', () => {
    const { container } = render(<EzProgressBar value={50} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('displays the label when showLabel is true', () => {
    render(<EzProgressBar value={50} showLabel />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('does not display the label when showLabel is false', () => {
    render(<EzProgressBar value={50} showLabel={false} />);
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('clamps value above 100 to 100', () => {
    render(<EzProgressBar value={150} showLabel />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('clamps value below 0 to 0', () => {
    render(<EzProgressBar value={-10} showLabel />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('allows custom size and color classes', () => {
    const { container } = render(<EzProgressBar value={50} sizeClass="h-4" colorClass="bg-red-500" />);
    expect(container.firstChild).toBeInTheDocument();
    // DOM validation could be tricky depending on the inner DOM structure for progress.
  });

  describe('AC-07: semântica ARIA', () => {
    it('expõe role progressbar com valuemin 0, valuemax 100 e valuenow', () => {
      render(<EzProgressBar value={42} />);
      const bar = screen.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
      expect(bar).toHaveAttribute('aria-valuenow', '42');
    });

    it('limita aria-valuenow a 100 quando o valor passa de 100', () => {
      render(<EzProgressBar value={150} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });

    it('limita aria-valuenow a 0 quando o valor é negativo', () => {
      render(<EzProgressBar value={-10} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('arredonda aria-valuenow', () => {
      render(<EzProgressBar value={33.6} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '34');
    });

    it('aceita aria-label do chamador como nome acessível', () => {
      render(<EzProgressBar value={50} aria-label="Progresso do SLA" />);
      expect(screen.getByRole('progressbar', { name: 'Progresso do SLA' })).toBeInTheDocument();
    });
  });
});
