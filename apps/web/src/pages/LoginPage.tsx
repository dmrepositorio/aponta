import { zodResolver } from '@hookform/resolvers/zod';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import axios from 'axios';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { EzAlert, EzButton, EzCardItem, EzModal, EzTextInput } from '../components/ds';
import { useFeatureFlag } from '../hooks/useFeatureFlag';

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', github: 'GitHub', facebook: 'Facebook' };

/** Motivo da falha do login social que a API põe no fragmento da URL (DMTE-551); qualquer outro vira a mensagem genérica. */
const SOCIAL_ERRORS: Record<string, string> = {
  not_found: 'Não há conta no Aponta com esse e-mail. Peça um convite ao administrador.',
  inactive: 'Esta conta está inativa. Fale com o administrador.',
  unverified: 'O provedor não confirmou o seu e-mail. Confirme-o lá e tente de novo.',
};
const SOCIAL_FALLBACK = 'Não foi possível entrar com a conta social. Tente de novo ou use e-mail e senha.';

const forgotEmailSchema = z.string().trim().max(254).email();

/** "Esqueci minha senha" (DMTE-550 D13): só o e-mail; a resposta é a mesma qualquer que seja ele. */
function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = forgotEmailSchema.safeParse(email);
    setInvalid(!parsed.success);
    if (!parsed.success || state === 'sending') return;
    setState('sending');
    try {
      await api.post('/auth/forgot-password', { email: parsed.data });
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  return (
    <EzModal
      isOpen
      onClose={onClose}
      trapFocus
      maxWidth="sm"
      title="Esqueci minha senha"
      footer={
        state === 'sent' ? (
          <EzButton type="button" label="Fechar" onClick={onClose} />
        ) : (
          <>
            <EzButton type="button" variant="tertiary" label="Cancelar" onClick={onClose} />
            <EzButton type="submit" form="forgot-password-form" label="Enviar" disabled={state === 'sending'} />
          </>
        )
      }
    >
      {state === 'sent' ? (
        <p role="status">Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.</p>
      ) : (
        <form id="forgot-password-form" onSubmit={submit} noValidate className="space-y-3">
          <p>Informe o e-mail da sua conta para receber o link.</p>
          <EzTextInput
            id="forgot-email"
            label="E-mail"
            type="email"
            autoComplete="email"
            spellCheck={false}
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hasError={invalid}
            message={invalid ? 'E-mail inválido' : undefined}
          />
          <div aria-live="polite">
            {state === 'failed' && <EzAlert variant="error">Algo deu errado. Tente novamente.</EzAlert>}
          </div>
        </form>
      )}
    </EzModal>
  );
}

/** Segundo passo do login (DMTE-551): o código do aplicativo ou de recuperação troca o desafio pelo JWT. */
function TwoFactorStep({ challengeToken, onBack, onExpired }: { challengeToken: string; onBack: () => void; onExpired: (message: string) => void }) {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const { data } = await api.post<{ access_token: string }>('/auth/login/2fa', { challengeToken, code: code.trim() });
      login(data.access_token);
      navigate('/');
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      const message = axios.isAxiosError(e) ? e.response?.data?.message : undefined;
      if (status === 401 && typeof message === 'string' && /expirada/i.test(message)) onExpired(message);
      else if (status === 401) setError('Código inválido.');
      else if (status === 429) setError('Muitas tentativas. Aguarde um minuto e tente de novo.');
      else setError('Algo deu errado. Tente novamente.');
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-80 text-gray-900">
      <form onSubmit={submit} noValidate className="w-full max-w-sm">
        <EzCardItem className="space-y-4 p-6">
          <h1 className="text-[20px] font-semibold text-gray-900">Segundo fator</h1>
          <p className="text-sm text-gray-700">Informe o código do aplicativo autenticador ou um código de recuperação.</p>
          <EzTextInput
            id="login-code"
            label="Código do aplicativo ou de recuperação"
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div aria-live="polite">{error && <EzAlert variant="error">{error}</EzAlert>}</div>
          <EzButton type="submit" disabled={sending} className="w-full">
            Entrar
          </EzButton>
          <button type="button" onClick={onBack} className="w-full text-center text-sm font-medium text-brand-700 hover:underline">
            Voltar
          </button>
        </EzCardItem>
      </form>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const canRecover = useFeatureFlag('convite-e-redefinicao-usuario');
  const { data: social } = useQuery<string[]>({
    queryKey: ['social-providers'],
    queryFn: async () => (await api.get<{ providers: string[] }>('/auth/social/providers')).data.providers,
    retry: false,
    staleTime: 5 * 60_000,
  });
  // O retorno do provedor traz o código de troca (ou o motivo da falha) no fragmento: lido uma vez e apagado da barra de endereço.
  const returned = useRef(false);
  useEffect(() => {
    if (returned.current) return;
    returned.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const code = params.get('social');
    const reason = params.get('social_error');
    if (!code && reason === null) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (reason !== null) {
      setSubmitError(SOCIAL_ERRORS[reason] ?? SOCIAL_FALLBACK);
      return;
    }
    api
      .post<{ access_token?: string; challengeToken?: string }>('/auth/social/exchange', { code })
      .then(({ data }) => {
        if (data.challengeToken) setChallengeToken(data.challengeToken);
        else if (data.access_token) {
          login(data.access_token);
          navigate('/');
        } else setSubmitError(SOCIAL_FALLBACK);
      })
      .catch(() => setSubmitError(SOCIAL_FALLBACK));
  }, [login, navigate]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      const { data } = await api.post<{ access_token?: string; challengeToken?: string }>(
        '/auth/login',
        values,
      );
      // Quem ativou o segundo fator recebe um desafio, não o JWT.
      if (data.challengeToken) {
        setChallengeToken(data.challengeToken);
        return;
      }
      if (!data.access_token) throw new Error('Resposta de login sem token.');
      login(data.access_token);
      navigate('/');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setSubmitError('E-mail ou senha inválidos.');
      } else {
        setSubmitError('Algo deu errado. Tente novamente.');
      }
    }
  };

  if (challengeToken) {
    return (
      <TwoFactorStep
        challengeToken={challengeToken}
        onBack={() => setChallengeToken(null)}
        onExpired={(message) => {
          setChallengeToken(null);
          setSubmitError(message);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-80 text-gray-900">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="w-full max-w-sm">
        <EzCardItem className="space-y-4 p-6">
          <h1 className="text-[20px] font-semibold text-gray-900">Entrar</h1>

          <EzTextInput
            id="email"
            label="E-mail"
            type="email"
            autoComplete="email"
            hasError={!!errors.email}
            message={errors.email?.message}
            {...register('email')}
          />

          <EzTextInput
            id="password"
            label="Senha"
            type="password"
            autoComplete="current-password"
            hasError={!!errors.password}
            message={errors.password?.message}
            {...register('password')}
          />

          {submitError && <EzAlert variant="error">{submitError}</EzAlert>}

          <EzButton type="submit" disabled={isSubmitting} className="w-full">
            Entrar
          </EzButton>

          {!!social?.length && (
            <div className="space-y-2">
              <p className="text-center text-sm text-gray-700">ou</p>
              {social.map((provider) => (
                <a
                  key={provider}
                  href={`/api/auth/social/${provider}/start`}
                  className="flex h-[42px] w-full items-center justify-center rounded-[12px] border border-gray-300 bg-white text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  Entrar com {PROVIDER_LABELS[provider] ?? provider}
                </a>
              ))}
            </div>
          )}

          {canRecover && (
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="w-full text-center text-sm font-medium text-brand-700 hover:underline"
            >
              Esqueci minha senha
            </button>
          )}
        </EzCardItem>
      </form>
      {forgotOpen && <ForgotPasswordModal onClose={() => setForgotOpen(false)} />}
    </div>
  );
}

export default LoginPage;
