import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
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
    fireEvent.change(screen.getByLabelText('Nome do contrato'), {
      target: { value: 'Outro' },
    });
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.change(screen.getByLabelText('Nome do contrato'), {
      target: { value: 'Suporte' },
    });
    expect(last(onDirtyChange)).toBe(false);
  });

  it('reports dirty for a checkbox, a number, a date and a select, and clean when each is restored', () => {
    const onDirtyChange = renderForm(existing);
    fireEvent.click(screen.getByLabelText('Condições comerciais aprovadas'));
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.click(screen.getByLabelText('Condições comerciais aprovadas'));
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(screen.getByLabelText('Franquia mensal (horas)'), {
      target: { value: '12' },
    });
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.change(screen.getByLabelText('Franquia mensal (horas)'), {
      target: { value: '10' },
    });
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(screen.getByLabelText('Início da vigência'), {
      target: { value: '2026-10-01' },
    });
    expect(last(onDirtyChange)).toBe(true);
    fireEvent.change(screen.getByLabelText('Início da vigência'), {
      target: { value: '' },
    });
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(
      screen.getByLabelText('Modalidade', { selector: 'select' }),
      { target: { value: 'HOURLY' } },
    );
    expect(last(onDirtyChange)).toBe(true);
  });

  it('treats the empty new-contract form as clean and a typed name as dirty', () => {
    const onDirtyChange = renderForm();
    expect(last(onDirtyChange)).toBe(false);
    fireEvent.change(screen.getByLabelText('Nome do contrato'), {
      target: { value: 'Novo' },
    });
    expect(last(onDirtyChange)).toBe(true);
  });

  it('does not report false dirt when the company is re-selected with the same value', () => {
    const onDirtyChange = renderForm(existing);
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org-1' },
    });
    expect(last(onDirtyChange)).toBe(false);
  });
});

describe('ContractForm campos monetários (CTR-07)', () => {
  const organizations = [
    {
      id: 'org',
      name: 'Empresa',
      serviceDesks: [{ id: 'desk', name: 'Desenvolvimento' }],
    },
  ];
  const MONEY_LABELS = [
    'Preço fechado (R$)',
    'Valor mensal (R$)',
    'Hora excedente (R$)',
    'Hora avulsa (R$)',
  ];
  const open = (type: string, contract?: Record<string, unknown>) => {
    const onSave = vi.fn();
    render(
      <ContractForm
        contract={contract as never}
        organizations={organizations}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org' },
    });
    fireEvent.change(
      screen.getByLabelText('Modalidade', { selector: 'select' }),
      { target: { value: type } },
    );
    return onSave;
  };
  const save = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('uses a masked R$ text field with a decimal keyboard for every money field, never a number spinner', () => {
    const seen = new Set<string>();
    for (const modalityValue of ['FIXED_PROJECT', 'MONTHLY_HOURS', 'HOURLY']) {
      const { unmount } = render(
        <ContractForm
          organizations={organizations}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      fireEvent.change(
        screen.getByLabelText('Modalidade', { selector: 'select' }),
        {
          target: { value: modalityValue },
        },
      );
      for (const label of MONEY_LABELS) {
        const input = screen.queryByLabelText(label);
        if (!input) continue;
        seen.add(label);
        expect(input).toHaveAttribute('type', 'text');
        expect(input).toHaveAttribute('inputmode', 'decimal');
      }
      unmount();
    }
    expect([...seen].sort()).toEqual([...MONEY_LABELS].sort());
  });

  it('shows 1234,56 as R$ 1.234,56 and saves 123456 cents in Valor mensal', () => {
    const onSave = open('MONTHLY_HOURS');
    type('Valor mensal (R$)', '1234,56');
    expect(screen.getByLabelText('Valor mensal (R$)')).toHaveValue(
      'R$ 1.234,56',
    );
    type('Franquia mensal (horas)', '10');
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyFeeCents: 123456,
        monthlyValue: 1234.56,
      }),
    );
  });

  it('saves Hora excedente, Preço fechado and Hora avulsa in whole cents', () => {
    let onSave = open('MONTHLY_HOURS');
    type('Hora excedente (R$)', '120,25');
    expect(screen.getByLabelText('Hora excedente (R$)')).toHaveValue(
      'R$ 120,25',
    );
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ excessHourlyRateCents: 12025 }),
    );
    cleanup();

    onSave = open('FIXED_PROJECT');
    type('Preço fechado (R$)', '15000,5');
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ fixedPriceCents: 1500050 }),
    );
    cleanup();

    onSave = open('HOURLY');
    type('Hora avulsa (R$)', '99,99');
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ hourlyRateCents: 9999 }),
    );
  });

  it('rejects e in a money field: the typed letter never reaches the value', () => {
    open('MONTHLY_HOURS');
    type('Valor mensal (R$)', '12');
    type('Valor mensal (R$)', 'R$ 12e');
    expect(screen.getByLabelText('Valor mensal (R$)')).toHaveValue('R$ 12');
  });

  it('keeps zero as a valid value and an empty field as no value', () => {
    let onSave = open('MONTHLY_HOURS');
    type('Valor mensal (R$)', '0');
    type('Hora excedente (R$)', '0');
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyFeeCents: 0,
        monthlyValue: 0,
        excessHourlyRateCents: 0,
      }),
    );
    cleanup();

    onSave = open('MONTHLY_HOURS');
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyFeeCents: null,
        monthlyValue: null,
        excessHourlyRateCents: null,
      }),
    );
  });

  it('opens an existing contract with the stored cents formatted, and saves them back unchanged', () => {
    const onSave = vi.fn();
    render(
      <ContractForm
        contract={{
          id: 'c1',
          organizationId: 'org',
          type: 'MONTHLY_HOURS',
          active: true,
          includedMinutes: 600,
          monthlyFeeCents: 850000,
          excessHourlyRateCents: 19050,
          createdAt: '2026-01-01',
        }}
        organizations={organizations}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Valor mensal (R$)')).toHaveValue(
      'R$ 8.500,00',
    );
    expect(screen.getByLabelText('Hora excedente (R$)')).toHaveValue(
      'R$ 190,50',
    );
    save();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        monthlyFeeCents: 850000,
        excessHourlyRateCents: 19050,
      }),
    );
  });

  it('refuses an amount above the API limit instead of sending it', () => {
    open('MONTHLY_HOURS');
    type('Valor mensal (R$)', '21474836,47');
    type('Valor mensal (R$)', '21474836,48');
    expect(screen.getByLabelText('Valor mensal (R$)')).toHaveValue(
      'R$ 21.474.836,47',
    );
  });

  it('marks the form dirty when only a money field changes', () => {
    const onDirtyChange = vi.fn();
    render(
      <ContractForm
        contract={{
          id: 'c1',
          organizationId: 'org',
          type: 'MONTHLY_HOURS',
          active: true,
          includedMinutes: 600,
          monthlyFeeCents: 100000,
          excessHourlyRateCents: 12000,
          createdAt: '2026-01-01',
        }}
        organizations={organizations}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    type('Valor mensal (R$)', '1000,01');
    expect(onDirtyChange.mock.calls.at(-1)?.[0]).toBe(true);
    type('Valor mensal (R$)', '1000');
    expect(onDirtyChange.mock.calls.at(-1)?.[0]).toBe(false);
  });
});
