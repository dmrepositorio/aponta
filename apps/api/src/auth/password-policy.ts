import { BadRequestException } from '@nestjs/common';

export interface PasswordOwner {
  name: string;
  email: string;
}

export const MIN_PASSWORD_LENGTH = 10;
const MIN_PART = 3;
// Rótulos de domínio curtos (com, net, org, br) são comuns demais para barrar a senha.
const MIN_DOMAIN_LABEL = 4;

/** Minúsculas e sem acento, para comparar "JOÃO" com "joao". */
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const parts = (text: string, min: number) => plain(text).split(/[^a-z]+/).filter((part) => part.length >= min);

/** Palavras do nome, do e-mail e do domínio que a senha não pode conter. */
function forbiddenWords({ name, email }: PasswordOwner): string[] {
  const [local = '', domain = ''] = email.split('@');
  const words = [
    ...parts(name, MIN_PART),
    plain(local),
    ...parts(local, MIN_PART),
    plain(domain),
    ...plain(domain).split('.').filter((label) => label.length >= MIN_DOMAIN_LABEL),
  ];
  return [...new Set(words)].filter((word) => word.length >= MIN_PART);
}

/** Lista o que falta na senha, em frases fixas; vazia quando ela cumpre a regra. */
export function checkPassword(password: string, owner: PasswordOwner): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  if (!/\p{Lu}/u.test(password)) problems.push('A senha precisa ter uma letra maiúscula.');
  if (!/\p{Ll}/u.test(password)) problems.push('A senha precisa ter uma letra minúscula.');
  if (!/\p{N}/u.test(password)) problems.push('A senha precisa ter um número.');
  if (!/[^\p{L}\p{N}]/u.test(password)) problems.push('A senha precisa ter um símbolo.');
  const typed = plain(password);
  if (forbiddenWords(owner).some((word) => typed.includes(word))) {
    problems.push('A senha não pode conter o seu nome, o seu e-mail ou o domínio dele.');
  }
  return problems;
}

export function assertPasswordPolicy(password: string, owner: PasswordOwner): void {
  const problems = checkPassword(password, owner);
  if (problems.length) throw new BadRequestException(problems);
}
