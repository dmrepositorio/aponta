import { useEffect, useState } from 'react';

const supportsMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Acompanha uma media query; sem `matchMedia` (jsdom, SSR) vale `false`, que é o layout largo. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (supportsMatchMedia() ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supportsMatchMedia()) return undefined;
    const list = window.matchMedia(query);
    const onChange = (event: { matches: boolean }) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
