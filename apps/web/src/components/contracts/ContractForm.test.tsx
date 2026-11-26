import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContractDetail, ContractForm } from './ContractViews';

describe('ContractForm precision', () => {
  const original = {
    id: 'contract-1',
    name: 'Suporte',
    organizationId: 'org-1',
    type: 'HOURS_LIMIT',
    active: true,
    includedMinutes: 30,
    startsAt: '2026-10-15T14:35:12.123Z',
    endsAt: '2026-11-16T02:20:55.456Z',
    adjustmentDate: '2026-12-01T09:25:00.000Z',
    createdAt: '2026-01-01',
  };
  it('preserves exact stored dates during an unrelated edit and sends minutes without legacy fractional hours', () => {
    const onSave = vi.fn();
    render(
      <ContractForm
        contract={original}
        organizations={[{ id: 'org-1', name: 'Empresa' }]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Nome do contrato'), {
      target: { value: 'Renomeado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renomeado',
        includedMinutes: 30,
        startsAt: original.startsAt,
        endsAt: original.endsAt,
        adjustmentDate: original.adjustmentDate,
      }),
    );
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('hoursLimit');
  });
  it('creates a half-hour allowance and full Brasília day boundaries', () => {
    const onSave = vi.fn();
    render(
      <ContractForm
        organizations={[{ id: 'org-1', name: 'Empresa' }]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org-1' },
    });
    fireEvent.change(screen.getByLabelText('Modalidade', { selector: 'select' }), {
      target: { value: 'MONTHLY_HOURS' },
    });
    fireEvent.change(screen.getByLabelText('Franquia mensal (horas)'), {
      target: { value: '0.5' },
    });
    fireEvent.change(screen.getByLabelText('Início da vigência'), {
      target: { value: '2026-10-15' },
    });
    fireEvent.change(screen.getByLabelText('Fim da vigência'), {
      target: { value: '2026-10-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        includedMinutes: 30,
        startsAt: '2026-10-15T03:00:00.000Z',
        endsAt: '2026-11-01T03:00:00.000Z',
      }),
    );
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('hoursLimit');
  });
  it('displays an inclusive final civil day rather than the next midnight boundary', () => {
    render(
      <ContractDetail
        contract={{
          ...original,
          startsAt: '2026-10-15T03:00:00.000Z',
          endsAt: '2026-10-16T03:00:00.000Z',
        }}
        showFinancial
      />,
    );
    const endingRow = screen.getByText('Fim da vigência').parentElement;
    expect(endingRow).not.toBeNull();
    expect(
      within(endingRow as HTMLElement).getByText('15/10/2026'),
    ).toBeInTheDocument();
    expect(screen.queryByText('16/10/2026')).not.toBeInTheDocument();
  });
});

describe('ContractForm onDirtyChange (CTR-02)', () => {
  const existing = {
    id: 'c1',
    name: 'Suporte',
    organizationId: 'org-1',
    type: 'MONTHLY_HOURS',
    active: true,
    approved: false,
    includedMinutes: 600,
    monthlyFeeCents: 100000,
    excessHourlyRateCents: 12000,
    createdAt: '2026-01-01',
  };
  const renderForm = (contract?: typeof existing) => {
    const onDirtyChange = vi.fn();
    render(
      <ContractForm
        contract={contract}
        organizations={[{ id: 'org-1', name: 'Empresa' }]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    return onDirtyChange;
  };
  const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0];

  it('reports a clean form when nothing changed', () => {
    const onDirtyChange = renderForm(existing);
    expect(last(onDirtyChange)).toBe(false);
  });

  it('reports dirty when a text field changes and clean again when it is restored', () => {
    const onDirtyChange = renderForm(existing);
    fireEvent.change(screen.getByLabelText('Nome do contrato'), { target: { value: 'Outro' } });
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.change(screen.getByLabelText('Nome do contrato'), { target: { value: 'Suporte' } });
    expect(last(onDirtyChange)).toBe(false);
  });

  it('reports dirty for a checkbox, a number, a date and a select, and clean when each is restored', () => {
    const onDirtyChange = renderForm(existing);
    fireEvent.click(screen.getByLabelText('Condições comerciais aprovadas'));
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.click(screen.getByLabelText('Condições comerciais aprovadas'));
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(screen.getByLabelText('Franquia mensal (horas)'), { target: { value: '12' } });
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.change(screen.getByLabelText('Franquia mensal (horas)'), { target: { value: '10' } });
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(screen.getByLabelText('Início da vigência'), { target: { value: '2026-10-01' } });
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.change(screen.getByLabelText('Início da vigência'), { target: { value: '' } });
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(screen.getByLabelText('Modalidade', { selector: 'select' }), { target: { value: 'HOURLY' } });
    expect(last(onDirtyChange)).toBe(true);
  });

  it('treats the empty new-contract form as clean and a typed name as dirty', () => {
    const onDirtyChange = renderForm();
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(screen.getByLabelText('Nome do contrato'), { target: { value: 'Novo' } });
    expect(last(onDirtyChange)).toBe(true);
  });

  it('does not report false dirt when the company is re-selected with the same value', () => {
    const onDirtyChange = renderForm(existing);
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), { target: { value: 'org-1' } });
    expect(last(onDirtyChange)).toBe(false);
  });
});
