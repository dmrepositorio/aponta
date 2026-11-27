import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../lib/api';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { apiErrorMessage } from '../hooks/useUsers';
import { EzAlert, EzBadge, EzButton, EzCheck, EzDialog, EzTextInput } from './ds';

const FLAG = 'autenticacao-dois-fatores';
type Setup = { secret: string; otpauthUri: string };
/** Cada fluxo mostra o próprio erro junto do formulário ou da ação que falhou. */
type Flow = 'begin' | 'confirm' | 'disable' | 'copy-key' | 'copy-codes';

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
  const [error, setError] = useState<{ flow: Flow; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const enabled = data?.enabled === true;
  // Sem a flag só aparece para quem já ativou (para poder desativar); durante a ativação, a seção segue até o fim.
  if (!data || (!flagOn && !enabled && !setup && !recoveryCodes)) return null;

  const run = async (action: () => Promise<void>, fallback: string, flow: Flow) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError({ flow, message: apiErrorMessage(e, fallback) });
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['two-factor-status'] });

  const begin = () =>
    run(async () => setSetup((await api.post<Setup>('/auth/2fa/setup')).data), 'Não foi possível iniciar a ativação.', 'begin');
  const flowError = (...flows: Flow[]) =>
    error && flows.includes(error.flow) ? <EzAlert variant="error" role="alert">{error.message}</EzAlert> : null;
  const confirm = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      setRecoveryCodes((await api.post<{ recoveryCodes: string[] }>('/auth/2fa/confirm', { code })).data.recoveryCodes);
      setSetup(null);
      setCode('');
    }, 'Não foi possível confirmar o código.', 'confirm');
  };
  // Desativar reduz a segurança da conta: o envio do formulário só abre a confirmação.
  const askDisable = (event: FormEvent) => {
    event.preventDefault();
    setConfirmDisable(true);
  };
  const disable = () => {
    setConfirmDisable(false);
    return run(async () => {
      await api.post('/auth/2fa/disable', { password, code });
      setPassword('');
      setCode('');
      await refresh();
    }, 'Não foi possível desativar.', 'disable');
  };
  const finish = async () => {
    setRecoveryCodes(null);
    setSaved(false);
    setNotice(null);
    await refresh();
  };
  const cancelSetup = () => {
    setSetup(null);
    setCode('');
    setError(null);
    setNotice(null);
  };
  // Os segredos ficam só no estado do componente: nada vai para storage nem para log.
  const copy = async (text: string, done: string, flow: Flow) => {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setNotice(done);
    } catch {
      setNotice(null);
      setError({ flow, message: 'Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.' });
    }
  };
  const download = (codes: string[]) => {
    const url = URL.createObjectURL(new Blob([codes.join('\n') + '\n'], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'codigos-de-recuperacao.txt';
    link.click();
    URL.revokeObjectURL(url);
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
          <div className="flex flex-wrap gap-2">
            <EzButton type="button" variant="secondary" size="small" onClick={() => copy(recoveryCodes.join('\n'), 'Códigos copiados.', 'copy-codes')}>
              Copiar códigos
            </EzButton>
            <EzButton type="button" variant="secondary" size="small" onClick={() => download(recoveryCodes)}>
              Baixar (.txt)
            </EzButton>
          </div>
          {flowError('copy-codes')}
          <EzCheck label="Guardei estes códigos" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <EzButton type="button" onClick={finish} disabled={!saved} disabledReason="Marque que guardou os códigos para concluir.">
            Concluir
          </EzButton>
        </div>
      )}

      {!recoveryCodes && setup && (
        <form onSubmit={confirm} noValidate className="space-y-3">
          <p className="text-sm text-gray-700">
            Escaneie o QR code com o aplicativo autenticador ou digite a chave, e informe o código de 6 dígitos que ele mostrar.
          </p>
          <QRCodeSVG value={setup.otpauthUri} size={160} role="img" aria-label="QR code para o aplicativo autenticador" />
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all font-mono text-sm tabular-nums">{setup.secret}</p>
            <EzButton type="button" variant="secondary" size="small" onClick={() => copy(setup.secret, 'Chave copiada.', 'copy-key')}>
              Copiar chave
            </EzButton>
          </div>
          <EzTextInput
            id="two-factor-code"
            label="Código do aplicativo"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value)}
          />
          {flowError('confirm', 'copy-key')}
          <div className="flex gap-2">
            <EzButton type="submit" disabled={busy} loading={busy} label={busy ? 'Confirmando...' : 'Confirmar'} />
            <EzButton type="button" variant="secondary" onClick={cancelSetup} disabled={busy}>Cancelar</EzButton>
          </div>
        </form>
      )}

      {!recoveryCodes && !setup && !enabled && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">Peça um código do aplicativo autenticador a cada entrada, além da senha.</p>
          {flowError('begin')}
          <EzButton type="button" onClick={begin} disabled={busy}>Ativar segundo fator</EzButton>
        </div>
      )}

      {!recoveryCodes && !setup && enabled && (
        <form onSubmit={askDisable} noValidate className="space-y-3">
          <EzBadge size="large">Ativado</EzBadge>
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
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {flowError('disable')}
          <EzButton type="submit" disabled={busy}>Desativar segundo fator</EzButton>
        </form>
      )}

      {notice && <p role="status" className="text-sm text-gray-700">{notice}</p>}

      <EzDialog
        open={confirmDisable}
        variant="danger"
        title="Desativar segundo fator?"
        message="Desativar reduz a segurança da conta: o acesso passará a depender só da senha, e os códigos de recuperação atuais deixam de valer."
        confirmLabel="Desativar segundo fator"
        onConfirm={disable}
        onCancel={() => setConfirmDisable(false)}
      />
    </section>
  );
}
