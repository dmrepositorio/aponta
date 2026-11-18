import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '../lib/api';

/** Mensagem fixa que a API devolve (nunca eco do que foi digitado); sem ela, o texto padrão. */
export function apiErrorMessage(error: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  const message = axios.isAxiosError(error) ? error.response?.data?.message : undefined;
  return typeof message === 'string' && message ? message : fallback;
}

export const apiErrorStatus = (error: unknown): number | undefined =>
  axios.isAxiosError(error) ? error.response?.status : undefined;

export interface GroupSummary {
  id: string;
  name: string;
}

export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  /** Convite pendente: o usuário ainda não definiu a senha (DMTE-550 D18). */
  pending: boolean;
  phone: string | null;
  extension: string | null;
  organizationId: string | null;
  technicalGroup: GroupSummary | null;
  permissionGroups: GroupSummary[];
  /** Segundo fator ativo (DMTE-551); o segredo e os códigos nunca vêm da API. */
  twoFactorEnabled: boolean;
}

export interface UsersListMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UsersListParams {
  q?: string;
  technicalGroupId?: string;
  permissionGroupId?: string;
  /** Tipos separados por vírgula (`AGENT,ADMIN`). */
  roles?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  page: number;
  pageSize: number;
}

/** Campos que o formulário envia; no PATCH só vai o que mudou, e `null` limpa os opcionais. */
export interface UserInput {
  name: string;
  email: string;
  role: string;
  phone: string | null;
  extension: string | null;
  organizationId: string | null;
  technicalGroupId: string | null;
  permissionGroupIds: string[];
}

export function useUsersList(params: UsersListParams) {
  return useQuery({
    queryKey: ['users', 'list', params],
    queryFn: async () => {
      const { data } = await api.get<{ data: UserListItem[]; meta: UsersListMeta }>('/users', {
        params,
      });
      return data;
    },
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: async () => {
      const { data } = await api.get<UserListItem>(`/users/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

function useUsersMutation<V, R>(mutationFn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useCreateUser() {
  return useUsersMutation(async (input: Partial<UserInput>) => (await api.post<UserListItem>('/users', input)).data);
}

export function useUpdateUser(id: string) {
  return useUsersMutation(async (input: Partial<UserInput>) => (await api.patch<UserListItem>(`/users/${id}`, input)).data);
}

export function useSetUserActive() {
  return useUsersMutation(async ({ id, active }: { id: string; active: boolean }) =>
    (await api.patch<UserListItem>(`/users/${id}/active`, { active })).data,
  );
}

/** Ativar ou inativar vários de uma vez: tudo ou nada, com as regras sobre o conjunto (API). */
export function useSetUsersActive() {
  return useUsersMutation(async ({ ids, active }: { ids: string[]; active: boolean }) => {
    await api.patch('/users/active', { ids, active });
  });
}

/** `invite` (usuário com convite pendente) ou `password-reset` (ativo, com senha); a API responde `{ ok: true }`. */
export function useSendUserLink(id: string, kind: 'invite' | 'password-reset') {
  return useMutation({
    mutationFn: async () => {
      await api.post(`/users/${id}/${kind}`);
    },
  });
}

/** Um administrador desativa o segundo fator de outro usuário (permissão DISABLE_USER_TWO_FACTOR). */
export function useDisableUserTwoFactor(id: string) {
  return useUsersMutation(async () => {
    await api.post(`/users/${id}/two-factor/disable`);
  });
}
