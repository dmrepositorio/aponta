import { AgendaAccess } from './agenda-access';

/** Para specs que exercitam o comportamento por perfil (flag desligada). */
export const legacyAgendaAccess = () =>
  new AgendaAccess({ isRbacPermissionOnly: () => false } as any, { hasPermission: async () => false } as any);
