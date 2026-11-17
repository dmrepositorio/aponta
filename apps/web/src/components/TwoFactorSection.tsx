import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { apiErrorMessage } from '../hooks/useUsers';
import { EzAlert, EzButton, EzTextInput } from './ds';

const FLAG = 'autenticacao-dois-fatores';
type Setup = { secret: string; otpauthUri: string };

/** Segundo fator em Minha Conta → Segurança (DMTE-551): ativar com QR e códigos de recuperação, e desativar. */
export function TwoFactorSection() {
  const flagOn = useFeatureFlag(FLAG);
  const queryClient = useQueryClient();
  const { data } = useQuery<{ enabled: boolean }>({
    queryKey: ['two-factor-status'],
    queryFn: async () => (await api.get<{ enabled: boolean }>('/auth/2fa/status')).data,
  });
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = data?.enabled === true;
  // Sem a flag só aparece para quem já ativou (para poder desativar); durante a ativação, a seção segue até o fim.
  if (!data || (!flagOn && !enabled && !setup && !recoveryCodes)) return null;

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['two-factor-status'] });

  const begin = () => run(async () => setSetup((await api.post<Setup>('/auth/2fa/setup')).data), 'Não foi possível iniciar a ativação.');
  const confirm = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      setRecoveryCodes((await api.post<{ recoveryCodes: string[] }>('/auth/2fa/confirm', { code })).data.recoveryCodes);
      setSetup(null);
      setCode('');
    }, 'Não foi possível confirmar o código.');
  };
  const disable = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      await api.post('/auth/2fa/disable', { password, code });
      setPassword('');
      setCode('');
      await refresh();
    }, 'Não foi possível desativar.');
  };
  const finish = async () => {
    setRecoveryCodes(null);
    await refresh();
  };

  return (
    <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-gray-900">Autenticação em dois fatores</h2>

      {recoveryCodes && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Guarde estes códigos de recuperação agora: eles não serão mostrados de novo. Cada um vale uma vez e substitui o código do aplicativo.
          </p>
          <ul aria-label="Códigos de recuperação" className="grid grid-cols-2 gap-1 font-mono text-sm tabular-nums">
            {recoveryCodes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <EzButton type="button" onClick={finish}>Concluir</EzButton>
        </div>
      )}

      {!recoveryCodes && setup && (
        <form onSubmit={confirm} noValidate className="space-y-3">
          <p className="text-sm text-gray-700">
            Escaneie o QR code com o aplicativo autenticador ou digite a chave, e informe o código de 6 dígitos que ele mostrar.
          </p>
          <QRCodeSVG value={setup.otpauthUri} size={160} role="img" aria-label="QR code para o aplicativo autenticador" />
          <p className="break-all font-mono text-sm tabular-nums">{setup.secret}</p>
          <EzTextInput
            id="two-factor-code"
            label="Código do aplicativo"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <EzButton type="submit" disabled={busy}>Confirmar</EzButton>
        </form>
      )}

      {!recoveryCodes && !setup && !enabled && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">Peça um código do aplicativo autenticador a cada entrada, além da senha.</p>
          <EzButton type="button" onClick={begin} disabled={busy}>Ativar segundo fator</EzButton>
        </div>
      )}

      {!recoveryCodes && !setup && enabled && (
        <form onSubmit={disable} noValidate className="space-y-3">
          <p className="font-medium text-gray-900">Ativado</p>
          <EzTextInput
            id="two-factor-password"
            label="Senha atual"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <EzTextInput
            id="two-factor-disable-code"
            label="Código do aplicativo ou de recuperação"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <EzButton type="submit" disabled={busy}>Desativar segundo fator</EzButton>
        </form>
      )}

      {error && <EzAlert variant="error" role="alert">{error}</EzAlert>}
    </section>
  );
}
