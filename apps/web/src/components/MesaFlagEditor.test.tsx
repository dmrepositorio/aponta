import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { MesaFlagEditor } from './MesaFlagEditor';
import { MesaSaveProvider } from './mesaSave';

vi.mock('../lib/api', () => ({
  api: { patch: vi.fn() },
}));

describe('MesaFlagEditor', () => {
  it('patches the selected flags for a mesa', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MesaFlagEditor
          deskId="sd-1"
          flags={[
            { key: 'catalogRequiredOnOpen', label: 'Catálogo obrigatório ao abrir' },
          ]}
          values={{ catalogRequiredOnOpen: false }}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByLabelText('Catálogo obrigatório ao abrir'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/service-desks/sd-1', {
        catalogRequiredOnOpen: true,
      });
    });
  });

  it('shows an error when saving flags fails', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('fail'));
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MesaSaveProvider>
          <MesaFlagEditor
            deskId="sd-1"
            flags={[{ key: 'catalogRequiredOnOpen', label: 'Catálogo obrigatório ao abrir' }]}
            values={{ catalogRequiredOnOpen: true }}
          />
        </MesaSaveProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Não foi possível salvar.');
    expect(alerts[0]).toHaveTextContent('Tente novamente.');
  });

  describe('DMTE-533', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function renderEditor(props: Partial<React.ComponentProps<typeof MesaFlagEditor>> = {}, withProvider = true) {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const editor = (
        <MesaFlagEditor
          deskId="sd-1"
          flags={[
            { key: 'a', label: 'Flag A' },
            { key: 'b', label: 'Flag B' },
          ]}
          values={{ a: true, b: true }}
          {...props}
        />
      );
      return render(
        <QueryClientProvider client={queryClient}>
          {withProvider ? <MesaSaveProvider>{editor}</MesaSaveProvider> : editor}
        </QueryClientProvider>,
      );
    }

    it('AC-09: without a group on the flags the flags stay in a single grid with no fieldset', () => {
      renderEditor();
      expect(screen.queryByRole('group')).not.toBeInTheDocument();
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    it('AC-07: with groups, each theme is a fieldset with a legend and the same payload keys', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: {} });
      const user = userEvent.setup();
      renderEditor({
        flags: [
          { key: 'a', label: 'Flag A', group: 'Tema 1' },
          { key: 'b', label: 'Flag B', group: 'Tema 2' },
        ],
      });
      const groups = screen.getAllByRole('group');
      expect(groups).toHaveLength(2);
      expect(within(groups[0]).getByText('Tema 1')).toBeInTheDocument();
      expect(within(groups[1]).getByLabelText('Flag B')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      await waitFor(() =>
        expect(api.patch).toHaveBeenCalledWith('/service-desks/sd-1', { a: true, b: true }),
      );
    });

    it('AC-09: works outside a MesaSaveProvider (no notice, no error)', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: {} });
      const user = userEvent.setup();
      renderEditor({}, false);
      await user.click(screen.getByLabelText('Flag A'));
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(api.patch).toHaveBeenCalled());
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('AC-02: the success notice goes away by itself after 5 s and the failure one stays until closed', async () => {
      vi.useFakeTimers();
      vi.mocked(api.patch).mockResolvedValueOnce({ data: {} });
      renderEditor();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      });
      expect(screen.getByRole('status')).toHaveTextContent('Alterações salvas.');
      await act(async () => {
        vi.advanceTimersByTime(4900);
      });
      expect(screen.getByRole('status')).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      vi.mocked(api.patch).mockRejectedValueOnce(new Error('rede'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
