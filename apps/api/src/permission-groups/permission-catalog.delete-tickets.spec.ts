import { DEFAULT_PERMISSION_GROUPS } from './default-permission-groups';
import { PERMISSION_CATALOG, PermissionCategory } from './permission-catalog';

describe('DELETE_TICKETS no catálogo (DMTE-560)', () => {
  it('AC-06: o catálogo tem DELETE_TICKETS na categoria administrativa, com o rótulo "Excluir tickets" (uma vez só)', () => {
    const entries = PERMISSION_CATALOG.filter((p) => p.key === 'DELETE_TICKETS');
    expect(entries).toEqual([{ key: 'DELETE_TICKETS', category: PermissionCategory.ADMINISTRATIVE, label: 'Excluir tickets' }]);
  });

  it('AC-06: nenhum grupo padrão de papel recebe DELETE_TICKETS (nem o de ADMIN); só um grupo explícito a concede', () => {
    for (const [role, group] of Object.entries(DEFAULT_PERMISSION_GROUPS)) {
      expect({ role, has: group.permissions.includes('DELETE_TICKETS') }).toEqual({ role, has: false });
    }
  });
});
