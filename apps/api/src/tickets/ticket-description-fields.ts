import { BadRequestException, Logger } from '@nestjs/common';
import {
  KNOWN_HTML_TAGS,
  sanitizeTicketDescription,
} from './sanitize-ticket-description';

const logger = new Logger('TicketDescription');

const TAG_NAME_RE = /<\s*([a-z][a-z0-9]*)/gi;

function countTags(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of html.matchAll(TAG_NAME_RE)) {
    const name = match[1].toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

const MAX_LOG_TAG_KEYS = 20;
const OTHER_KEY = 'outros';

/**
 * Contagem por nome de tag descartada: só nomes e números, nunca conteúdo.
 * O nome vem do cliente, então só tags HTML conhecidas viram chave; o resto e
 * o excedente de MAX_LOG_TAG_KEYS vão para `outros` (total preservado).
 */
function removedTagCounts(before: string, after: string): Record<string, number> {
  const kept = countTags(after);
  const named: Array<[string, number]> = [];
  let others = 0;
  for (const [name, count] of countTags(before)) {
    const diff = count - (kept.get(name) ?? 0);
    if (diff <= 0) continue;
    if (KNOWN_HTML_TAGS.has(name)) named.push([name, diff]);
    else others += diff;
  }
  named.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const removed: Record<string, number> = {};
  for (const [name, diff] of named.slice(0, MAX_LOG_TAG_KEYS)) removed[name] = diff;
  for (const [, diff] of named.slice(MAX_LOG_TAG_KEYS)) others += diff;
  if (others > 0) removed[OTHER_KEY] = others;
  return removed;
}

// `<br>` vira `<br />` na serialização; isso não é remoção e não deve poluir o log.
const withoutVoidSlash = (html: string) => html.replace(/\s*\/>/g, '>');

/**
 * Único ponto que produz os campos de `Ticket.description` a gravar. Recebe a
 * descrição crua do DTO e devolve o objeto de dados a espalhar em
 * `ticket.create`/`ticket.update`. Pura e idempotente (fora o log), nunca
 * devolve `undefined`; falha do sanitizador vira 400 genérico, nunca o valor cru.
 */
export function ticketDescriptionFields(description: string): {
  description: string;
  descriptionText: string;
} {
  let sanitized: string;
  try {
    sanitized = sanitizeTicketDescription(description);
  } catch {
    throw new BadRequestException('Descrição inválida');
  }

  if (withoutVoidSlash(sanitized) !== withoutVoidSlash(description)) {
    logger.log({
      antes: description.length,
      depois: sanitized.length,
      removido: removedTagCounts(description, sanitized),
    });
  }

  // Stub neutro do RED (GH-370 T1): o texto derivado entra no commit GREEN.
  return { description: sanitized, descriptionText: sanitized };
}
