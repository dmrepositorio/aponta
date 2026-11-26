import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContractForm, ContractDetail, modality } from './ContractViews';

describe('commercial contract setup', () => {
  const organizations = [
    {
      id: 'org',
      name: 'Empresa',
      serviceDesks: [{ id: 'desk', name: 'Desenvolvimento' }],
    },
  ];
  it('approves a monthly contract with explicit zero allowance and zero fee', () => {
    const save = vi.fn();
    render(<ContractForm organizations={organizations} onSave={save} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), { target: { value: 'org' } });
    fireEvent.change(screen.getByLabelText('Modalidade', { selector: 'select' }), { target: { value: 'MONTHLY_HOURS' } });
    fireEvent.change(screen.getByLabelText('Franquia mensal (horas)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Valor mensal (R$)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Hora excedente (R$)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Início da vigência'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByLabelText('Desenvolvimento'));
    fireEvent.click(screen.getByLabelText('Condições comerciais aprovadas'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: 'MONTHLY_HOURS', approved: true, includedMinutes: 0, monthlyFeeCents: 0, excessHourlyRateCents: 12000 }));
  });
  it('blocks approval without explicit desk coverage and commercial terms', () => {
    const save = vi.fn();
    render(
      <ContractForm
        organizations={organizations}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org' },
    });
    fireEvent.change(screen.getByLabelText('Modalidade', { selector: 'select' }), {
      target: { value: 'HOURLY' },
    });
    fireEvent.click(screen.getByLabelText('Condições comerciais aprovadas'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(
      screen.getByText(/Para aprovar, escolha uma modalidade atual/),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
  it('saves fixed-project scope, total estimate and explicit desks without a monthly allowance', () => {
    const save = vi.fn();
    render(
      <ContractForm
        organizations={organizations}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org' },
    });
    fireEvent.change(screen.getByLabelText('Modalidade', { selector: 'select' }), {
      target: { value: 'FIXED_PROJECT' },
    });
    fireEvent.change(screen.getByLabelText('Escopo aprovado'), {
      target: { value: 'API de integração' },
    });
    fireEvent.change(screen.getByLabelText('Preço fechado (R$)'), {
      target: { value: '1500.50' },
    });
    fireEvent.change(screen.getByLabelText('Estimativa total (horas)'), {
      target: { value: '10.5' },
    });
    fireEvent.change(screen.getByLabelText('Início da vigência'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.click(screen.getByLabelText('Desenvolvimento'));
    fireEvent.click(screen.getByLabelText('Condições comerciais aprovadas'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'FIXED_PROJECT',
        approved: true,
        serviceDeskIds: ['desk'],
        scope: 'API de integração',
        fixedPriceCents: 150050,
        estimatedMinutes: 630,
        includedMinutes: null,
      }),
    );
  });
  it('preserves legacy meaning and explains that regularization blocks new hours', () => {
    render(
      <ContractDetail
        contract={{
          id: 'legacy',
          organizationId: 'org',
          type: 'FIXED_COVERAGE',
          active: true,
          createdAt: '2026-01-01',
        }}
        showFinancial={false}
      />,
    );
    expect(
      screen.getByText(/Novos lançamentos bloqueados até regularizar/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Empreito')).not.toBeInTheDocument();
  });
});

describe('horas em pt-BR (CTR-06)', () => {
  const base = {
    id: 'c',
    organizationId: 'org',
    active: true,
    createdAt: '2026-01-01',
  };
  const estimate = (minutes: number | undefined) => {
    const { unmount } = render(
      <ContractDetail
        contract={{ ...base, type: 'FIXED_PROJECT', estimatedMinutes: minutes }}
        showFinancial={false}
      />,
    );
    const text =
      screen.getByText('Estimativa total').nextElementSibling?.textContent;
    unmount();
    return text;
  };
  it('shows the total estimate with a decimal comma and at most two places', () => {
    expect(estimate(80)).toBe('1,33h');
  });
  it('shows whole and half hours without trailing zeros', () => {
    expect(estimate(60)).toBe('1h');
    expect(estimate(90)).toBe('1,5h');
  });
  it('shows zero and missing estimates as 0h', () => {
    expect(estimate(0)).toBe('0h');
    expect(estimate(undefined)).toBe('0h');
  });
  it('shows large estimates with the thousands separator', () => {
    expect(estimate(120000)).toBe('2.000h');
  });
  it('shows the package allowance with a decimal comma', () => {
    expect(modality({ ...base, type: 'HOURS_LIMIT', hoursLimit: 1.5 })).toBe(
      'Pacote: 1,5h',
    );
    expect(
      modality({ ...base, type: 'HOURS_LIMIT', includedMinutes: 80 }),
    ).toBe('Pacote: 1,33h');
    expect(modality({ ...base, type: 'HOURS_LIMIT', hoursLimit: 40 })).toBe(
      'Pacote: 40h',
    );
  });
  it('keeps the dash when the package has no allowance', () => {
    expect(modality({ ...base, type: 'HOURS_LIMIT' })).toBe('Pacote: —h');
  });
});
