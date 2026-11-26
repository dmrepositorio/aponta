import { useEffect } from 'react';

// Contador global: modais aninhados compartilham o bloqueio e só o último a fechar libera a página.
let locks = 0;
let previous = '';

/** Trava a rolagem do body enquanto `active` for true. Cada chamador conta um lock. */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return undefined;
    if (locks === 0) previous = document.body.style.overflow;
    locks += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previous;
    };
  }, [active]);
}
