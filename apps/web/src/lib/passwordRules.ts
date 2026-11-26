export interface PasswordRule {
  id: string;
  label: string;
  met: boolean;
}

export interface PasswordOwner {
  name?: string;
  email?: string;
}

// Mesma regra do servidor (apps/api/src/auth/password-policy.ts); o servidor é quem decide, aqui só se mostra.
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const parts = (text: string, min: number) => plain(text).split(/[^a-z]+/).filter((part) => part.length >= min);

function forbiddenWords({ name = '', email = '' }: PasswordOwner): string[] {
  const [local = '', domain = ''] = email.split('@');
  const words = [
    ...parts(name, 3),
    plain(local),
    ...parts(local, 3),
    plain(domain),
    ...plain(domain).split('.').filter((label) => label.length >= 4),
  ];
  return [...new Set(words)].filter((word) => word.length >= 3);
}

export function passwordRules(password: string, owner: PasswordOwner = {}): PasswordRule[] {
  const rules: PasswordRule[] = [
    { id: 'length', label: 'Pelo menos 10 caracteres', met: password.length >= 10 },
    { id: 'upper', label: 'Uma letra maiúscula', met: /\p{Lu}/u.test(password) },
    { id: 'lower', label: 'Uma letra minúscula', met: /\p{Ll}/u.test(password) },
    { id: 'digit', label: 'Um número', met: /\p{N}/u.test(password) },
    { id: 'symbol', label: 'Um símbolo', met: /[^\p{L}\p{N}]/u.test(password) },
  ];
  const words = forbiddenWords(owner);
  if (words.length) {
    const typed = plain(password);
    rules.push({ id: 'personal', label: 'Não conter seu nome, e-mail ou o domínio dele', met: !words.some((word) => typed.includes(word)) });
  }
  return rules;
}

/** Verdadeiro quando a senha cumpre todas as regras mostradas na tela (o servidor continua sendo a autoridade). */
export function allRulesMet(password: string, owner: PasswordOwner = {}): boolean {
  return passwordRules(password, owner).every(({ met }) => met);
}

/** Mensagens de regra de senha devolvidas pelo servidor (400 com lista), ou `null` para qualquer outro erro. */
export function policyMessages(error: unknown): string[] | null {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  const message = response?.data?.message;
  return response?.status === 400 && Array.isArray(message) && message.every((m) => typeof m === 'string') ? message : null;
}
