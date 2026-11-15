import { Check, Minus } from 'lucide-react';
import { EzTag } from './ds';

/**
 * Tags de estado da mesa (SPEC DMTE-530). Positivo = verde com check; negativo = cinza com traço.
 * Estado se lê pelo texto e pelo ícone, não só pela cor, e sem vermelho (reservado a vencido,
 * crítico e escalado, DMTE-525). O ícone herda a cor do texto, então o contraste é o mesmo.
 */

/** Pares [texto, fundo] de token; o teste confere contraste AA (4.5:1) em styles.css. */
export const serviceDeskStateTokenPairs: Record<string, [string, string]> = {
  positive: ['green-800', 'green-100'],
  negative: ['gray-700', 'gray-90'],
  inactiveRow: ['gray-500', 'gray-70'],
};

/** Texto da linha de uma mesa inativa (mais fraco que `gray-900`, ainda acima de 4.5:1). */
export const inactiveRowText = 'text-gray-500';

const iconClass = 'h-3 w-3';
const positiveIcon = <Check data-glyph="check" aria-hidden="true" className={iconClass} strokeWidth={3} />;
const negativeIcon = <Minus data-glyph="minus" aria-hidden="true" className={iconClass} strokeWidth={3} />;

function StateTag({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <EzTag
      label={on ? onLabel : offLabel}
      variant={on ? 'green' : 'gray'}
      className="whitespace-nowrap"
      leftIcon={on ? positiveIcon : negativeIcon}
    />
  );
}

export function ServiceDeskActiveTag({ active }: { active: boolean }) {
  return <StateTag on={active} onLabel="Ativa" offLabel="Inativa" />;
}

export function ServiceDeskReceivingTag({ receiving }: { receiving: boolean }) {
  return <StateTag on={receiving} onLabel="Recebendo" offLabel="Não recebe" />;
}
