import { CheckCircle2, Circle } from 'lucide-react';
import { passwordRules, type PasswordOwner } from '../lib/passwordRules';

/** Lista a regra da senha e marca o que a senha digitada já cumpre. */
export function PasswordRules({ password, name, email }: { password: string } & PasswordOwner) {
  const rules = passwordRules(password, { name, email });
  const metCount = rules.filter(({ met }) => met).length;
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {metCount} de {rules.length} regras atendidas
      </p>
      <ul aria-label="Regras da senha" className="space-y-1 text-sm">
      {rules.map(({ id, label, met }) => (
        <li key={id} className={`flex items-center gap-2 ${met ? 'text-green-700' : 'text-gray-700'}`}>
          {met ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" /> : <Circle aria-hidden="true" className="h-4 w-4 shrink-0" />}
          <span>
            {label}
            <span className="sr-only">{met ? ' (atendida)' : ' (pendente)'}</span>
          </span>
        </li>
      ))}
      </ul>
    </>
  );
}

/** O que o servidor recusou na senha, uma linha por regra. */
export function PolicyErrors({ messages }: { messages: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
