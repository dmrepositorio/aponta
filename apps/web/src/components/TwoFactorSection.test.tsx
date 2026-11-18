import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { TwoFactorSection } from './TwoFactorSection';

vi.mock('../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let flagOn = true;
vi.mock('../hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flagOn }));

// DMTE-551 T4, AC-16 (seção Minha Conta): ativar, ver o QR e os códigos de recuperação, e desativar.
const URI = 'otpauth://totp/Aponta:ana%40aponta.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Aponta';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const CODES = Array.from({ length: 10 }, (_, i) => `ABCD${i}-EFGH${i}`.replace(/[01]/g, 'X'));
const badRequest = (message: string) => ({ isAxiosError: true, response: { status: 400, data: { message } } });

let enabled = false;
const renderSection = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TwoFactorSection /></QueryClientProvider>);
};
const heading = () => screen.queryByRole('heading', { name: /autenticação em dois fatores/i });

describe('TwoFactorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagOn = true;
    enabled = false;
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: { enabled } }));
  });

  it('AC-16: com a flag desligada e sem segundo fator ativo a seção não aparece', async () => {
    flagOn = false;
    renderSection();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/2fa/status'));
    expect(heading()).not.toBeInTheDocument();
  });

  it('AC-16: ativar mostra o QR e a chave, confirma com o código e mostra os 10 códigos de recuperação uma vez', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/auth/2fa/setup') return Promise.resolve({ data: { secret: SECRET, otpauthUri: URI } });
      if (url === '/auth/2fa/confirm') return Promise.resolve({ data: { recoveryCodes: CODES } });
      return Promise.reject(new Error(url));
    });
    renderSection();

    await user.click(await screen.findByRole('button', { name: /ativar/i }));

    expect(await screen.findByRole('img', { name: /qr code/i })).toBeInTheDocument();
    expect(screen.getByText(SECRET)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/código do aplicativo/i), '123456');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(api.post).toHaveBeenCalledWith('/auth/2fa/confirm', { code: '123456' });
    const list = await screen.findByRole('list', { name: /códigos de recuperação/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText(/não serão mostrados de novo/i)).toBeInTheDocument();

    enabled = true;
    await user.click(screen.getByRole('button', { name: /concluir/i }));

    expect(await screen.findByText(/ativado/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /códigos de recuperação/i })).not.toBeInTheDocument();
  });

  it('AC-16: código recusado na confirmação mostra o erro e deixa tentar de novo', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockImplementation((url: string) =>
      url === '/auth/2fa/setup' ? Promise.resolve({ data: { secret: SECRET, otpauthUri: URI } }) : Promise.reject(badRequest('Código inválido.')),
    );
    renderSection();

    await user.click(await screen.findByRole('button', { name: /ativar/i }));
    await user.type(await screen.findByLabelText(/código do aplicativo/i), '000000');
    await user.click(screen.getByRole('button', { name: /confirmar/i }));

    expect(await screen.findByText(/código inválido/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/código do aplicativo/i)).toBeEnabled();
  });

  it('AC-16: quem já ativou vê "Ativado" e desativa com a senha atual e um código, mesmo com a flag desligada', async () => {
    const user = userEvent.setup();
    flagOn = false;
    enabled = true;
    vi.mocked(api.post).mockResolvedValue({ data: { ok: true } });
    renderSection();

    expect(await screen.findByText(/ativado/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/senha atual/i), 'Senha#Antiga1');
    await user.type(screen.getByLabelText(/código/i), '123456');
    enabled = false;
    await user.click(screen.getByRole('button', { name: /desativar/i }));

    expect(api.post).toHaveBeenCalledWith('/auth/2fa/disable', { password: 'Senha#Antiga1', code: '123456' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument());
  });

  it('AC-16: senha ou código recusado ao desativar mostra o erro e mantém o segundo fator ativo', async () => {
    const user = userEvent.setup();
    enabled = true;
    vi.mocked(api.post).mockRejectedValue(badRequest('Senha ou código inválido.'));
    renderSection();

    await user.type(await screen.findByLabelText(/senha atual/i), 'errada');
    await user.type(screen.getByLabelText(/código/i), '123456');
    await user.click(screen.getByRole('button', { name: /desativar/i }));

    expect(await screen.findByText(/senha ou código inválido/i)).toBeInTheDocument();
    expect(screen.getByText(/ativado/i)).toBeInTheDocument();
  });
});
