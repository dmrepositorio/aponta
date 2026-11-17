import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { api } from '../lib/api';
import { EzAlert, EzButton, EzCardItem, EzTextInput } from '../components/ds';

/**
 * Página pública do link de convite e de redefinição (DMTE-550 D12/AC-19). O token vem no fragmento
 * (`#t=…`), que não vai ao servidor nem a outros sites: a página o lê, o apaga da barra de endereço e o
 * guarda só em memória até o POST, que leva `token` e `password` e mais nada.
 */
const TOKEN_FORMAT = /^[0-9a-f]{64}$/i;
const PASSWORD_ERROR = 'A senha deve ter de 8 a 128 caracteres.';

type Phase = 'checking' | 'form' | 'invalid' | 'done';

/** Lê o token do fragmento e o apaga da barra de endereço; `null` se faltar ou estiver mal formado. */
function consumeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t');
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token && TOKEN_FORMAT.test(token) ? token : null;
}

export function SetPasswordPage() {
  // `undefined` = ainda não lido. Ref, não state: o StrictMode roda o efeito duas vezes e o fragmento só existe na primeira.
  const token = useRef<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token.current === undefined) token.current = consumeToken();
    setPhase(token.current ? 'form' : 'invalid');
    // A página nunca manda o endereço completo adiante (a barra já está sem o token, mas o caminho é o do convite).
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || !token.current) return;
    const next: typeof errors = {};
    if (password.length < 8 || password.length > 128) next.password = PASSWORD_ERROR;
    else if (confirmation !== password) next.confirmation = 'As senhas não conferem.';
    setErrors(next);
    if (next.password) return passwordInput.current?.focus();
    if (next.confirmation) return confirmationInput.current?.focus();

    setSubmitError(null);
    setSending(true);
    try {
      await api.post('/auth/password/set', { token: token.current, password });
      setPassword('');
      setConfirmation('');
      setPhase('done');
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // 400 (link recusado) e 404 (recurso desligado) têm a mesma resposta fixa, sem o texto do servidor.
      if (status === 400 || status === 404) setPhase('invalid');
      else setSubmitError('Algo deu errado. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-80 px-4 text-gray-900">
      <EzCardItem className="w-full max-w-sm space-y-4 p-6">
        <h1 className="text-[20px] font-semibold text-gray-900">Definir senha</h1>

        {phase === 'form' && (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div aria-live="polite" className="space-y-4">
              <EzTextInput
                ref={passwordInput}
                id="new-password"
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hasError={!!errors.password}
                message={errors.password ?? 'De 8 a 128 caracteres.'}
              />
              <EzTextInput
                ref={confirmationInput}
                id="confirm-password"
                label="Confirmar senha"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                hasError={!!errors.confirmation}
                message={errors.confirmation}
              />
            </div>
            {submitError && <EzAlert variant="error">{submitError}</EzAlert>}
            <EzButton type="submit" disabled={sending} className="w-full">
              Definir senha
            </EzButton>
          </form>
        )}

        {phase === 'invalid' && (
          <div className="space-y-3">
            <p className="font-medium text-red-700">Link inválido ou expirado.</p>
            <p className="text-sm text-gray-700">
              Peça outro: na tela de entrada, use Esqueci minha senha, ou peça um novo convite ao administrador.
            </p>
            <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
              Voltar para o login
            </Link>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3">
            <p role="status" className="font-medium text-gray-900">
              Senha definida.
            </p>
            <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
              Ir para o login
            </Link>
          </div>
        )}
      </EzCardItem>
    </div>
  );
}

export default SetPasswordPage;
