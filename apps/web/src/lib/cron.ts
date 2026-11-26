interface CronField {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const FIELDS: CronField[] = [
  { name: 'minuto', min: 0, max: 59 },
  { name: 'hora', min: 0, max: 23 },
  { name: 'dia do mês', min: 1, max: 31 },
  { name: 'mês', min: 1, max: 12, names: MONTHS },
  { name: 'dia da semana', min: 0, max: 7, names: WEEKDAYS },
];

const NUMBER = /^\d+$/;

function toValue(token: string, field: CronField): number | null {
  if (NUMBER.test(token)) return Number(token);
  const index = field.names?.indexOf(token.toLowerCase()) ?? -1;
  if (index < 0) return null;
  // Meses começam em 1; dias da semana em 0.
  return field.name === 'mês' ? index + 1 : index;
}

function validateItem(item: string, field: CronField): string | null {
  const invalid = `Campo inválido: ${field.name} (${field.min}-${field.max}).`;
  const [range, step, ...extra] = item.split('/');
  if (extra.length > 0) return invalid;
  if (step !== undefined && (!NUMBER.test(step) || Number(step) < 1)) {
    return `Passo inválido no campo ${field.name}: use um número maior que 0 depois da barra.`;
  }
  if (range === '*') return null;
  const [from, to, ...rest] = range.split('-');
  if (rest.length > 0) return invalid;
  const start = toValue(from, field);
  const end = to === undefined ? start : toValue(to, field);
  if (start === null || end === null) return invalid;
  if (start < field.min || end > field.max) return invalid;
  if (end < start) return `Intervalo inválido no campo ${field.name}: o início passa do fim.`;
  return null;
}

/**
 * Valida localmente uma expressão cron de 5 campos (minuto hora dia mês dia-da-semana).
 * Devolve a mensagem de erro, ou `null` quando a expressão é aceitável.
 * O servidor continua sendo a autoridade (ex.: recusa `0 0 31 2 *`).
 */
export function validateCron(expression: string): string | null {
  const parts = expression.trim().split(/\s+/);
  if (expression.trim() === '' || parts.length !== FIELDS.length) {
    return 'Informe 5 campos: minuto hora dia mês dia-da-semana.';
  }
  for (let i = 0; i < FIELDS.length; i += 1) {
    for (const item of parts[i].split(',')) {
      const error = validateItem(item, FIELDS[i]);
      if (error) return error;
    }
  }
  return null;
}
