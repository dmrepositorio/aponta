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
import { EzCardItem } from '../components/ds';

interface SettingsLinkProps {
  to: string;
  label: string;
  icon: LucideIcon;
}

function SettingsLink({ to, label, icon: Icon }: SettingsLinkProps) {
  return (
    <Link
      to={to}
      className="flex min-h-[var(--control-height-md)] items-center justify-between gap-3 px-4 py-2 text-[14px] text-gray-900 transition-colors hover:bg-gray-90 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-200"
    >
      <span className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-gray-500" />
        {label}
      </span>
      <ChevronRight className="h-4 w-4 text-gray-400" />
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
 */
export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const { isLoading } = useEffectivePermissions();
  const isAdmin = user?.role === 'ADMIN';
  const canManageUsers = useHasPermission('MANAGE_USERS');
  const canManagePermissionGroups = useHasPermission('MANAGE_PERMISSION_GROUPS');
  const canManageScheduledJobs = useHasPermission('MANAGE_SCHEDULED_JOBS');

  const groups = [
    {
      title: 'Conta',
      links: [{ to: '/my-account', label: 'Minha conta', icon: User, visible: true }],
    },
    {
      title: 'Usuários',
      links: [
        { to: '/settings/users', label: 'Usuários', icon: Users, visible: canManageUsers },
        {
          to: '/settings/technical-groups',
          label: 'Grupos de atendentes',
          icon: UserCog,
          visible: canManageUsers,
        },
        {
          to: '/settings/permission-groups',
          label: 'Grupos de permissões',
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
          icon: Timer,
          visible: canManageScheduledJobs,
        },
        { to: '/service-desks', label: 'Mesa', icon: Box, visible: isAdmin },
      ],
    },
  ]
    .map((group) => ({ ...group, links: group.links.filter((link) => link.visible) }))
    .filter((group) => group.links.length > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-[20px] font-semibold text-gray-900">
        Configurações
      </h1>

      {isLoading ? (
        <EzCardItem flat className="p-0" role="status" aria-busy="true">
          <span className="sr-only">Carregando configurações</span>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex min-h-[var(--control-height-md)] items-center px-4">
              <div className="h-4 w-1/3 animate-pulse rounded-control bg-gray-90" />
            </div>
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
                    <SettingsLink to={link.to} label={link.label} icon={link.icon} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </EzCardItem>
      )}
    </div>
  );
}

export default SettingsPage;
