import { BRASILIA_TZ } from './brasiliaTime';

const formatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: BRASILIA_TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Formata um instante como "dd/mm/aaaa HH:mm" no fuso de Brasília, para que a
 * lista e o detalhe do chamado mostrem o mesmo prazo no mesmo formato, sem
 * depender do fuso do navegador. Data inválida volta como veio.
 */
export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
