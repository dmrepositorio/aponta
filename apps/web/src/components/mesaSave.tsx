import type { ReactNode } from 'react';

// Stub importável (DMTE-533): o comportamento entra depois do RED.
export function MesaSaveProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useMesaSave(_dirty: boolean) {
  return { saved: () => undefined, failed: (_what?: string) => undefined };
}
