import { TicketTransitionAccess } from './ticket-transition-access';

/** Para specs que exercitam o comportamento por perfil (flag desligada). */
export const legacyTransitionAccess = () =>
  new TicketTransitionAccess({ isRbacPermissionOnly: () => false } as any, { hasPermission: async () => false } as any);
