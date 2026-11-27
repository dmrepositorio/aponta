import type { ReactNode } from 'react';

export interface RequirePermissionProps {
  /** Chave da permissão granular (a mesma que o backend exige). */
  permission: string;
  /** Título da página, usado no cabeçalho dos estados de guarda. */
  title: string;
  children: ReactNode;
}

// Stub neutro (RED): ainda repassa tudo; a guarda real vem no commit GREEN.
export function RequirePermission({ children }: RequirePermissionProps) {
  return <>{children}</>;
}

export default RequirePermission;
