import { type KeyboardEvent, type RefObject, useEffect } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Foco preso em `ref` enquanto `active`: o foco entra no contêiner ao abrir (se nada dentro dele já o
 * tiver, por exemplo um `autoFocus`) e Tab/Shift+Tab ciclam dentro. O contêiner precisa de `tabIndex={-1}`.
 * Devolve o `onKeyDown` a ligar no contêiner; teclas vindas de fora dele no DOM (portais React, como um
 * diálogo filho) são ignoradas, pois a camada de cima cuida da própria trava.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const node = ref.current;
    if (active && node && !node.contains(document.activeElement)) node.focus();
  }, [ref, active]);

  return (event: KeyboardEvent<HTMLElement>) => {
    const node = ref.current;
    if (!active || event.key !== 'Tab' || !node || !(event.target instanceof Node) || !node.contains(event.target)) return;
    const nodes = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    const [first, last] = [nodes[0], nodes[nodes.length - 1]];
    const current = document.activeElement;
    if (nodes.length === 0 || (event.shiftKey && (current === first || current === node))) {
      event.preventDefault();
      (event.shiftKey ? last : node)?.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
