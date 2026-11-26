import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useDeletePermissionGroup, useUpdatePermissionGroupPermissions } from './usePermissionGroups';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useUpdatePermissionGroupPermissions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('grava a resposta do PATCH como detalhe do grupo sem esperar o refetch', async () => {
    const { queryClient, wrapper } = setup();
    const updated = { id: 'pg-1', name: 'G', permissions: ['MANAGE_USERS'], userMembers: [], technicalGroupLinks: [] };
    vi.mocked(api.patch).mockResolvedValue({ data: updated });
    vi.mocked(api.get).mockReturnValue(new Promise(() => undefined));
    queryClient.setQueryData(['permission-groups', 'pg-1'], { ...updated, permissions: [] });
    const { result } = renderHook(() => useUpdatePermissionGroupPermissions('pg-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(['MANAGE_USERS']);
    });

    expect(api.patch).toHaveBeenCalledWith('/permission-groups/pg-1/permissions', { permissions: ['MANAGE_USERS'] });
    expect(queryClient.getQueryData(['permission-groups', 'pg-1'])).toEqual(updated);
  });
});

describe('useDeletePermissionGroup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
  });

  it('remove só o detalhe do grupo excluído do cache e preserva o de outro grupo', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(['permission-groups', 'pg-1'], { id: 'pg-1' });
    queryClient.setQueryData(['permission-groups', 'pg-2'], { id: 'pg-2' });
    const { result } = renderHook(() => useDeletePermissionGroup(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('pg-1');
    });

    expect(api.delete).toHaveBeenCalledWith('/permission-groups/pg-1');
    expect(queryClient.getQueryData(['permission-groups', 'pg-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['permission-groups', 'pg-2'])).toEqual({ id: 'pg-2' });
  });

  it('invalida a lista de grupos para recarregá-la', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(['permission-groups'], [{ id: 'pg-1' }]);
    const { result } = renderHook(() => useDeletePermissionGroup(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('pg-1');
    });

    await waitFor(() => expect(queryClient.getQueryState(['permission-groups'])?.isInvalidated).toBe(true));
  });
});
