import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SlaBadge } from './SlaBadge';

describe('SlaBadge', () => {
  it('renders nothing when status is null or undefined', () => {
    const { container: c1 } = render(<SlaBadge status={null} label="Resposta" />);
    expect(c1).toBeEmptyDOMElement();

    const { container: c2 } = render(<SlaBadge status={undefined} label="Resposta" />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('renders a green "Dentro do prazo" badge for ON_TRACK', () => {
    render(<SlaBadge status="ON_TRACK" label="Resposta" />);
    const badge = screen.getByText(/dentro do prazo/i);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/green/);
  });

  it('renders a yellow "Em risco" badge for AT_RISK', () => {
    render(<SlaBadge status="AT_RISK" label="Resposta" />);
    const badge = screen.getByText(/em risco/i);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/yellow|amber/);
  });

  it('renders a red "Vencido" badge for BREACHED', () => {
    render(<SlaBadge status="BREACHED" label="Resolução" />);
    const badge = screen.getByText(/vencido/i);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/red/);
  });

  it('includes the provided label in the accessible text', () => {
    render(<SlaBadge status="BREACHED" label="Resolução" />);
    expect(screen.getByText(/resolução/i)).toBeInTheDocument();
  });

  it('GH-446 DET-03: com SLA pausado mostra "Pausado" neutro em vez do selo verde/vermelho', () => {
    const { container, rerender } = render(<SlaBadge status="ON_TRACK" label="SLA" paused />);
    expect(screen.getByText(/pausado/i)).toBeInTheDocument();
    expect(screen.queryByText(/dentro do prazo/i)).not.toBeInTheDocument();
    expect(container.firstElementChild?.className).toMatch(/gray/);
    expect(container.firstElementChild?.className).not.toMatch(/green|red/);

    rerender(<SlaBadge status="BREACHED" label="SLA" paused />);
    expect(screen.getByText(/pausado/i)).toBeInTheDocument();
    expect(screen.queryByText(/vencido/i)).not.toBeInTheDocument();
  });

  it('GH-446 DET-03: paused=false mantém o selo do status', () => {
    render(<SlaBadge status="ON_TRACK" label="SLA" paused={false} />);
    expect(screen.getByText(/dentro do prazo/i)).toBeInTheDocument();
    expect(screen.queryByText(/pausado/i)).not.toBeInTheDocument();
  });
});
