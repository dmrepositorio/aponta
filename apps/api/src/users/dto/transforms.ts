import { Transform } from 'class-transformer';

/** Aparar só mexe em texto; qualquer outro tipo segue intacto para o validador recusar. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
/** Chave do e-mail (DMTE-550 D5): aparado e em minúsculas; um só lugar para a regra. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const TrimLower = () => Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value));
/** Texto opcional que o formulário pode esvaziar: vazio vira nulo. */
export const TrimOrNull = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
