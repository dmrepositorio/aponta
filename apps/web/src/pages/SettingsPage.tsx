import { Link } from 'react-router-dom';
import {
  User,
  Users,
  UserCog,
  ShieldCheck,
  Box,
  Timer,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useEffectivePermissions, useHasPermission } from '../hooks/usePermissions';
import { EzAlert, EzButton, EzCardItem, EzPageHeader, EzPageLayout } from '../components/ds';

interface SettingsLinkProps {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

function SettingsLink({ to, label, description, icon: Icon }: SettingsLinkProps) {
  const labelId = `settings-link-${to}-label`;
  const descriptionId = `settings-link-${to}-description`;
  return (
    // aria-labelledby mantém o nome do link só no rótulo; a descrição entra por aria-describedby.
    <Link
      to={to}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      className="flex min-h-[var(--control-height-md)] items-center justify-between gap-3 px-4 py-2 text-[14px] text-gray-900 transition-colors hover:bg-gray-90 active:bg-gray-100 ez-focus-inset"
    >
      <span className="flex items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-gray-500" />
        <span className="flex flex-col">
          <span id={labelId}>{label}</span>
          <span id={descriptionId} className="text-xs text-gray-500">
            {description}
          </span>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
    </Link>
  );
}

/**
 * Settings hub — mirrors the Tiflux reference UI. Groups: Conta (Minha conta),
 * Usuários (Usuários / Grupos de atendentes / Grupos de permissões, DMTE-84
 * Tarefa 4 SPEC) and Sistema (Tarefas agendadas / Mesa). Each item beyond
 * "Minha conta" is gated by the matching granular permission instead of
 * `role === 'ADMIN'`; Mesa stays ADMIN-only. Permissions come from
 * GET /auth/me, so the cards wait for it (DMTE-524) instead of growing in two steps.
 * The page uses the same shell as the other screens (EzPageLayout + EzPageHeader,
 * DMTE-564) and the skeleton mirrors the groups and rows of the real card.
 * F3-22: each link carries a one-line description, a failed /auth/me shows an alert with
 * retry, and whoever sees fewer areas than the full hub gets an access hint at the end.
 */
export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  // failureCount > 0: a primeira falha já devolve a página (só Minha conta) em vez de esperar os retries do React Query.
  const { isLoading, failureCount, isError, refetch } = useEffectivePermissions();
  const permissionsFailed = isError || failureCount > 0;
  const isAdmin = user?.role === 'ADMIN';
  const canManageUsers = useHasPermission('MANAGE_USERS');
  const canManagePermissionGroups = useHasPermission('MANAGE_PERMISSION_GROUPS');
  const canManageScheduledJobs = useHasPermission('MANAGE_SCHEDULED_JOBS');

  const allGroups = [
    {
      title: 'Conta',
      links: [
        {
          to: '/my-account',
          label: 'Minha conta',
          description: 'Seus dados, senha e autenticação em duas etapas',
          icon: User,
          visible: true,
        },
      ],
    },
    {
      title: 'Usuários',
      links: [
        {
          to: '/settings/users',
          label: 'Usuários',
          description: 'Quem acessa o Aponta e com qual perfil',
          icon: Users,
          visible: canManageUsers,
        },
        {
          to: '/settings/technical-groups',
          label: 'Grupos de atendentes',
          description: 'Equipes que recebem chamados',
          icon: UserCog,
          visible: canManageUsers,
        },
        {
          to: '/settings/permission-groups',
          label: 'Grupos de permissões',
          description: 'O que cada perfil pode fazer',
          icon: ShieldCheck,
          visible: canManagePermissionGroups,
        },
      ],
    },
    {
      title: 'Sistema',
      links: [
        {
          to: '/settings/scheduled-jobs',
          label: 'Tarefas agendadas',
          description: 'Rotinas automáticas e histórico de execuções',
          icon: Timer,
          visible: canManageScheduledJobs,
        },
        {
          to: '/service-desks',
          label: 'Mesa',
          description: 'Mesas de serviço e suas etapas',
          icon: Box,
          visible: isAdmin,
        },
      ],
    },
  ];
  const groups = allGroups
    .map((group) => ({ ...group, links: group.links.filter((link) => link.visible) }))
    .filter((group) => group.links.length > 0);
  // Dica só quando a lista está completa e algo ficou de fora; em falha de carga a lista está incompleta por erro, não por permissão.
  const hasHiddenLinks =
    !permissionsFailed &&
    groups.reduce((total, group) => total + group.links.length, 0) <
      allGroups.reduce((total, group) => total + group.links.length, 0);

  // shortcut: o skeleton usa a forma do ADMIN (grupos de 1, 3 e 2 linhas) ou só "Minha conta"; atualizar junto com `groups`.
  const skeletonGroups = isAdmin ? [1, 3, 2] : [1];

  return (
    <EzPageLayout header={<EzPageHeader title="Configurações" />}>
      {permissionsFailed && (
        <EzAlert
          variant="error"
          title="Não foi possível carregar suas permissões"
          className="mb-4"
          action={<EzButton variant="secondary" size="small" label="Tentar de novo" onClick={() => void refetch()} />}
        >
          Por enquanto só Minha conta está disponível.
        </EzAlert>
      )}
      {isLoading && failureCount === 0 ? (
        <EzCardItem
          flat
          className="divide-y divide-gray-90 overflow-hidden p-0"
          role="status"
          aria-busy="true"
        >
          {skeletonGroups.map((rowCount, groupIndex) => (
            <section key={groupIndex}>
              <div className="px-4 pb-1 pt-3">
                {/* sr-only dentro do 1º grupo: um irmão a mais no cartão ganharia o divisor do divide-y e mudaria a altura. */}
                {groupIndex === 0 && <span className="sr-only">Carregando configurações</span>}
                <div className="h-4 w-16 animate-pulse rounded-control bg-gray-90" />
              </div>
              {/* box-content: o divisor de 1 px entra na altura da linha, como na linha real (SettingsLink dentro de <li>). */}
              <ul className="divide-y divide-gray-90">
                {Array.from({ length: rowCount }, (_, row) => (
                  <li key={row} className="box-content flex min-h-[var(--control-height-md)] items-center px-4 py-2">
                    {/* duas barras: rótulo e descrição, como a linha real de duas linhas. */}
                    <div className="flex w-full flex-col gap-1.5">
                      <div className="h-4 w-1/3 animate-pulse rounded-control bg-gray-90" />
                      <div className="h-3 w-1/2 animate-pulse rounded-control bg-gray-90" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </EzCardItem>
      ) : (
        <EzCardItem flat className="divide-y divide-gray-90 overflow-hidden p-0">
          {groups.map(({ title, links }) => (
            <section key={title} aria-labelledby={`settings-${title}`}>
              <h2
                id={`settings-${title}`}
                className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                {title}
              </h2>
              <ul className="divide-y divide-gray-90">
                {links.map((link) => (
                  <li key={link.to}>
                    <SettingsLink to={link.to} label={link.label} description={link.description} icon={link.icon} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </EzCardItem>
      )}
      {hasHiddenLinks && !isLoading && (
        <p className="mt-4 text-[13px] text-gray-500">
          Algumas áreas dependem de permissão. Se faltar uma, peça acesso a um administrador.
        </p>
      )}
    </EzPageLayout>
  );
}

export default SettingsPage;
