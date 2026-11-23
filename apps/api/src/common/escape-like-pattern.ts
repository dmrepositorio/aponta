/**
 * Escapa os curingas do LIKE (`\`, `%` e `_`) com a barra invertida, o escape
 * padrão do Postgres. O `contains` do Prisma não escapa: sem isto `%` e `_`
 * casariam tudo e a barra invertida nunca casaria. Use em todo `contains`
 * alimentado por entrada do usuário.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}
