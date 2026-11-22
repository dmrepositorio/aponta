import { BadRequestException, Logger } from '@nestjs/common';
import { sanitizeTicketDescription } from './sanitize-ticket-description';

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

/** Contagem por nome de tag descartada: só nomes e números, nunca conteúdo. */
function removedTagCounts(before: string, after: string): Record<string, number> {
  const kept = countTags(after);
  const removed: Record<string, number> = {};
  for (const [name, count] of countTags(before)) {
    const diff = count - (kept.get(name) ?? 0);
    if (diff > 0) removed[name] = diff;
  }
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

  return { description: sanitized };
}
