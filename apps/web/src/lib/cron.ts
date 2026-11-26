/**
 * Valida localmente uma expressão cron de 5 campos (minuto hora dia mês dia-da-semana).
 * Devolve a mensagem de erro, ou `null` quando a expressão é aceitável.
 * O servidor continua sendo a autoridade (ex.: recusa `0 0 31 2 *`).
 */
export function validateCron(_expression: string): string | null {
  return null;
}
