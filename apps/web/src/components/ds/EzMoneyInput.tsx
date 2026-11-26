import { forwardRef } from 'react';
import { EzTextInput } from './EzTextInput';

export interface EzMoneyInputProps {
  /** Valor em centavos inteiros; null = campo vazio (diferente de zero). */
  value: number | null;
  /** Recebe os centavos inteiros (ou null quando o campo é esvaziado). */
  onChange: (cents: number | null) => void;
  label?: string;
  message?: string;
  hasError?: boolean;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  className?: string;
  /** Maior valor aceito, em centavos. @default Number.MAX_SAFE_INTEGER */
  max?: number;
}

/**
 * Aponta DS Money Input. Stub neutro: o comportamento (máscara R$ pt-BR em centavos) entra no commit GREEN.
 */
export const EzMoneyInput = forwardRef<HTMLInputElement, EzMoneyInputProps>(
  ({ value, onChange, max: _max, ...rest }, ref) => (
    <EzTextInput
      ref={ref}
      type="number"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      {...rest}
    />
  ),
);

EzMoneyInput.displayName = 'EzMoneyInput';
