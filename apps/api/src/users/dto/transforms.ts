import { Transform } from 'class-transformer';

/** Aparar só mexe em texto; qualquer outro tipo segue intacto para o validador recusar. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export const TrimLower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
/** Texto opcional que o formulário pode esvaziar: vazio vira nulo. */
export const TrimOrNull = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value));
