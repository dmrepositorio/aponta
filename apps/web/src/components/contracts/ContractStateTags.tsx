import { Check, Pencil, TriangleAlert } from 'lucide-react';
import { EzTag } from '../ds';

/**
 * Tags de estado do contrato (SPEC DMTE-536). Aprovado = verde com check (Ativo/Inativo está em `ActiveTag`);
 * Rascunho e Regularização pendente = amarelo (ambos bloqueiam novos lançamentos), com lápis e triângulo.
 * Estado se lê pelo texto e pelo ícone, não só pela cor, e sem vermelho (reservado a vencido, crítico e
 * escalado, DMTE-525). O ícone herda a cor do texto, então o contraste é o mesmo.
 */
export type ApprovalState = 'Aprovado' | 'Rascunho' | 'Regularização pendente';

/** Pares [texto, fundo] de token; o teste confere contraste AA (4.5:1) em styles.css. */
export const contractStateTokenPairs: Record<string, [string, string]> = {
  approved: ['green-800', 'green-100'],
  draft: ['yellow-800', 'yellow-100'],
  legacy: ['yellow-800', 'yellow-100'],
};

/** Único texto de aprovação do contrato: a grade, o detalhe e o filtro usam esta função. */
export function approvalLabel({ legacy, approved }: { legacy: boolean; approved: boolean }): ApprovalState {
  return legacy ? 'Regularização pendente' : approved ? 'Aprovado' : 'Rascunho';
}

const iconProps = { 'aria-hidden': true, className: 'h-3 w-3', strokeWidth: 3 } as const;

const approvalStyle = {
  Aprovado: { variant: 'green', icon: <Check data-glyph="check" {...iconProps} /> },
  Rascunho: { variant: 'yellow', icon: <Pencil data-glyph="pencil" {...iconProps} /> },
  'Regularização pendente': { variant: 'yellow', icon: <TriangleAlert data-glyph="alert" {...iconProps} /> },
} as const;

export function ContractApprovalTag({ state }: { state: ApprovalState }) {
  return (
    <EzTag
      label={state}
      variant={approvalStyle[state].variant}
      className="whitespace-nowrap"
      leftIcon={approvalStyle[state].icon}
    />
  );
}
