import type { ReactNode } from 'react';
import { useEffectivePermissions } from '../hooks/usePermissions';
import {
  EzButton,
  EzEmptyCard,
  EzPageHeader,
  EzPageLayout,
  EzSpinner,
} from './ds';

export interface RequirePermissionProps {
  /** Chave da permissão granular (a mesma que o backend exige na rota). */
  permission: string;
  /** Título da página, usado no cabeçalho dos estados de guarda. */
  title: string;
  children: ReactNode;
}

/**
 * Guarda de rota por permissão (F3-22 SET-01): sem a permissão (ou ADMIN) a página nem monta, então
 * nenhuma consulta dela sai. Só reflexo da tela; a autorização continua no servidor. Enquanto
 * /auth/me carrega mostra o carregando e, se falhar, o erro com nova tentativa, sem piscar "sem acesso".
 */
export function RequirePermission({
  permission,
  title,
  children,
}: RequirePermissionProps) {
  const { data, isError, refetch } = useEffectivePermissions();
  if (isError) {
    return (
      <EzPageLayout header={<EzPageHeader title={title} />}>
        <EzEmptyCard
          title="Não foi possível verificar suas permissões."
          action={
            <EzButton
              variant="secondary"
              size="small"
              label="Tentar de novo"
              onClick={() => void refetch()}
            />
          }
        />
      </EzPageLayout>
    );
  }
  if (!data) {
    return (
      <EzPageLayout header={<EzPageHeader title={title} />}>
        <div className="p-8">
          <EzSpinner label="Carregando permissões…" />
        </div>
      </EzPageLayout>
    );
  }
  if (!data.isAdmin && !data.permissions.includes(permission)) {
    return (
      <EzPageLayout header={<EzPageHeader title={title} />}>
        <EzEmptyCard
          title="Sem acesso a esta área"
          description="Você não tem permissão para abrir esta tela."
        />
      </EzPageLayout>
    );
  }
  return <>{children}</>;
}

export default RequirePermission;
