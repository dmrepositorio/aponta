import { Check, Clock, Minus } from 'lucide-react';
import { EzTag } from './ds';

/**
 * Status Ativo/Inativo único de Clientes, Usuários e Contratos (SPEC DMTE-541, moveu o tag de Contratos).
 * Verde com check e cinza com traço: o estado se lê pelo texto e pelo ícone, não só pela cor, sem vermelho
 * e sem `emerald` cru. O ícone herda a cor do texto, então o contraste é o mesmo.
 * DMTE-550 D19: `pending` (senha ainda não definida) mostra "Convite pendente", amarelo com relógio; inativo vence.
 */

/** Pares [texto, fundo] de token; o teste confere contraste AA (4.5:1) em styles.css. */
export const activeTagTokenPairs: Record<string, [string, string]> = {
  active: ['green-800', 'green-100'],
  inactive: ['gray-700', 'gray-90'],
  pending: ['yellow-800', 'yellow-100'],
};

const iconProps = { 'aria-hidden': true, className: 'h-3 w-3', strokeWidth: 3 } as const;

export function ActiveTag({ active, pending = false }: { active: boolean; pending?: boolean }) {
  if (active && pending) {
    return (
      <EzTag
        label="Convite pendente"
        variant="yellow"
        className="whitespace-nowrap"
        leftIcon={<Clock data-glyph="clock" {...iconProps} />}
      />
    );
  }
  return (
    <EzTag
      label={active ? 'Ativo' : 'Inativo'}
      variant={active ? 'green' : 'gray'}
      className="whitespace-nowrap"
      leftIcon={active ? <Check data-glyph="check" {...iconProps} /> : <Minus data-glyph="minus" {...iconProps} />}
    />
  );
}
