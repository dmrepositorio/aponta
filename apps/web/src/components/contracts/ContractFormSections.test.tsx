import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContractForm } from './ContractViews';

const organizations = [
  {
    id: 'org',
    name: 'Empresa',
    serviceDesks: [
      { id: 'desk-a', name: 'Desenvolvimento' },
      { id: 'desk-b', name: 'Suporte' },
    ],
  },
];

const renderForm = (props: Partial<Parameters<typeof ContractForm>[0]> = {}) =>
  render(
    <ContractForm
      organizations={organizations}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );

// Nome, Empresa, Modalidade, 3 datas, 3 valores da modalidade, Novas condições e 5 checkboxes.
const FIELDS_IN_EDIT_FORM = 15;

const group = (name: string) => screen.getByRole('group', { name });

describe('ContractForm sections', () => {
  it('groups the fields in fieldsets with a legend each', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Empresa/, { selector: 'select' }), {
      target: { value: 'org' },
    });
    const identity = within(group('Identificação'));
    expect(identity.getByLabelText('Nome do contrato')).toBeInTheDocument();
    expect(identity.getByLabelText(/Empresa/, { selector: 'select' })).toBeInTheDocument();
    expect(identity.getByLabelText('Modalidade', { selector: 'select' })).toBeInTheDocument();

    const validity = within(group('Vigência'));
    expect(validity.getByLabelText('Início da vigência')).toBeInTheDocument();
    expect(validity.getByLabelText('Fim da vigência')).toBeInTheDocument();
    expect(validity.getByLabelText('Data de reajuste')).toBeInTheDocument();

    const terms = within(group('Condições comerciais'));
    expect(terms.getByLabelText('Franquia mensal (horas)')).toBeInTheDocument();
    expect(terms.getByLabelText('Valor mensal (R$)')).toBeInTheDocument();
    expect(terms.getByLabelText('Hora excedente (R$)')).toBeInTheDocument();
    expect(terms.queryByLabelText('Novas condições a partir de')).not.toBeInTheDocument();

    const desks = within(group('Mesas de serviços cobertas'));
    expect(desks.getByRole('checkbox', { name: 'Desenvolvimento' })).toBeInTheDocument();
    expect(desks.getByRole('checkbox', { name: 'Suporte' })).toBeInTheDocument();
  });

  it('keeps the fields of each modality and the amendment date in the commercial terms', () => {
    renderForm({
      contract: {
        id: 'c1',
        organizationId: 'org',
        type: 'FIXED_PROJECT',
        active: true,
        createdAt: '2026-01-01',
      },
    });
    const terms = within(group('Condições comerciais'));
    expect(terms.getByLabelText('Escopo aprovado')).toBeInTheDocument();
    expect(terms.getByLabelText('Preço fechado (R$)')).toBeInTheDocument();
    expect(terms.getByLabelText('Estimativa total (horas)')).toBeInTheDocument();
    expect(terms.getByLabelText('Novas condições a partir de')).toBeInTheDocument();
  });

  it('puts the two switches together in one group before the identification', () => {
    renderForm();
    const status = group('Situação do contrato');
    const boxes = within(status).getAllByRole('checkbox');
    expect(boxes.map((box) => box.closest('label')?.textContent)).toEqual([
      'Contrato ativo',
      'Condições comerciais aprovadas',
    ]);
    expect(
      status.compareDocumentPosition(group('Identificação')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws every checkbox with the DS control and keeps what onSave receives', () => {
    const onSave = vi.fn();
    renderForm({
      onSave,
      contract: {
        id: 'c1',
        organizationId: 'org',
        type: 'MONTHLY_HOURS',
        active: true,
        serviceDeskIds: ['desk-a', 'gone'],
        serviceDesks: [{ id: 'gone', name: 'Mesa antiga' }],
        createdAt: '2026-01-01',
      },
    });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(5);
    boxes.forEach((box) => {
      expect(box).toHaveClass('appearance-none', 'checked:bg-brand-600');
    });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Contrato ativo' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Desenvolvimento' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Suporte' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        approved: false,
        serviceDeskIds: ['gone', 'desk-b'],
      }),
    );
  });

  it('toggles the approval switch into what onSave receives', () => {
    const onSave = vi.fn();
    renderForm({
      onSave,
      contract: {
        id: 'c1',
        organizationId: 'org',
        type: 'HOURLY',
        active: true,
        hourlyRateCents: 5000,
        startsAt: '2026-10-15T03:00:00.000Z',
        serviceDeskIds: ['desk-a'],
        createdAt: '2026-01-01',
      },
    });
    const approved = screen.getByRole('checkbox', { name: 'Condições comerciais aprovadas' });
    expect(approved).not.toBeChecked();
    fireEvent.click(approved);
    expect(approved).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar contrato' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true, active: true, serviceDeskIds: ['desk-a'] }),
    );
  });

  it('disables every field and checkbox while saving', () => {
    const { container } = renderForm({
      pending: true,
      contract: {
        id: 'c1',
        organizationId: 'org',
        type: 'MONTHLY_HOURS',
        active: true,
        serviceDeskIds: ['gone'],
        serviceDesks: [{ id: 'gone', name: 'Mesa antiga' }],
        createdAt: '2026-01-01',
      },
    });
    const fields = container.querySelectorAll('input, select');
    expect(fields).toHaveLength(FIELDS_IN_EDIT_FORM);
    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    fields.forEach((field) => expect(field).toBeDisabled());
    screen.getAllByRole('checkbox').forEach((box) => {
      expect(box.closest('label')).toHaveClass('cursor-not-allowed');
    });
  });

  it('keeps the empty-desks hint and the unlinked desk warning inside the desks group', () => {
    renderForm({
      organizations: [{ id: 'org', name: 'Empresa', serviceDesks: [] }],
      contract: {
        id: 'c1',
        organizationId: 'org',
        type: 'MONTHLY_HOURS',
        active: true,
        serviceDeskIds: ['gone'],
        serviceDesks: [{ id: 'gone', name: 'Mesa antiga' }],
        createdAt: '2026-01-01',
      },
    });
    const desks = within(group('Mesas de serviços cobertas'));
    const unlinked = desks.getByRole('checkbox', {
      name: /Mesa não vinculada à empresa \(Mesa antiga\) — remova para regularizar/,
    });
    expect(unlinked).toBeChecked();
    expect(desks.getByText(/Selecione uma empresa com mesas explicitamente vinculadas/)).toBeInTheDocument();
    fireEvent.click(unlinked);
    expect(desks.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
