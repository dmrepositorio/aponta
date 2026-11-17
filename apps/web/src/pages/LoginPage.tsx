import { zodResolver } from '@hookform/resolvers/zod';
import { FormEvent, useState } from 'react';
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

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const canRecover = useFeatureFlag('convite-e-redefinicao-usuario');
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
      const { data } = await api.post<{ access_token: string }>(
        '/auth/login',
        values,
      );
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
