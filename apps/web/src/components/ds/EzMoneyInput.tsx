import { forwardRef, useEffect, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { formatCents, parseMoney } from '../../lib/moneyCents';
import { EzTextInput } from './EzTextInput';

export interface EzMoneyInputProps {
  /** Valor em centavos inteiros; null = campo vazio (diferente de zero). */
  value: number | null;
  /** Recebe os centavos inteiros (ou null quando o campo é esvaziado). */
  onChange: (cents: number | null) => void;
  /**
   * Rótulo do campo.
   */
  label?: string;
  /**
   * Texto auxiliar ou de erro abaixo do campo.
   */
  message?: string;
  hasError?: boolean;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  /**
   * @default 'R$ 0,00'
   */
  placeholder?: string;
  className?: string;
  /**
   * Maior valor aceito, em centavos. Acima dele a digitação (ou a colagem) é recusada e o campo mantém o
   * último valor aceito.
   * @default Number.MAX_SAFE_INTEGER
   */
  max?: number;
}

/**
 * Aponta DS Money Input
 * Campo de dinheiro pt-BR com máscara "R$ 1.234,56". O valor sai em centavos inteiros (sem ponto
 * flutuante); vazio é `null` e zero é um valor válido. Campo de texto com teclado decimal: sem setas, sem
 * roda do mouse, sem "e" nem sinal negativo. A vírgula separa os centavos (até 2 casas, a 3ª é ignorada);
 * ao colar, formatos ambíguos como "1,234" são recusados em vez de adivinhados.
 */
export const EzMoneyInput = forwardRef<HTMLInputElement, EzMoneyInputProps>(
  (
    {
      value,
      onChange,
      max = Number.MAX_SAFE_INTEGER,
      placeholder = 'R$ 0,00',
      ...rest
    },
    ref,
  ) => {
    const [text, setText] = useState(() => formatCents(value));

    // Valor trocado por fora (outro registro, restauração): o texto o acompanha. O texto que o próprio
    // usuário está digitando ("R$ 12,") já corresponde ao valor e não é reescrito.
    useEffect(() => {
      setText((current) =>
        (parseMoney(current, 'typing')?.cents ?? null) === value
          ? current
          : formatCents(value),
      );
    }, [value]);

    const accept = (raw: string, mode: 'typing' | 'paste') => {
      // Ponto digitado no fim, sem vírgula ainda, é a vírgula decimal (teclado numérico).
      const typed =
        mode === 'typing' &&
        text !== '' &&
        !text.includes(',') &&
        raw === `${text}.`
          ? `${text},`
          : raw;
      // Edição que encurta o texto (Backspace/Delete): os pontos que sobram são os de milhar da máscara.
      const deleting = mode === 'typing' && raw.length < text.length;
      const parsed = parseMoney(typed, mode, { deleting });
      if (!parsed || (parsed.cents !== null && parsed.cents > max)) return;
      setText(parsed.text);
      if (parsed.cents !== value) onChange(parsed.cents);
    };

    const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
      event.preventDefault();
      accept(event.clipboardData.getData('text'), 'paste');
    };

    return (
      <EzTextInput
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(event) => accept(event.target.value, 'typing')}
        onPaste={handlePaste}
        // Ao sair, completa os centavos ("R$ 12,5" vira "R$ 12,50"); o valor não muda.
        onBlur={() => setText(formatCents(value))}
        {...rest}
      />
    );
  },
);

EzMoneyInput.displayName = 'EzMoneyInput';
