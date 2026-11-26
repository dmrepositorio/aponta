import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import { useState, useMemo, useRef } from 'react';
import { Search, Trash2, CreditCard, Plus, RefreshCw, FilePlus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  EzAlert,
  EzButton,
  EzCheck,
  EzComboBox,
  EzDialog,
  EzDynamicFilter,
  EzEmptyCard,
  EzEntityGrid,
  EzEntityToolbar,
  EzEntityScreenConfigModal,
  EzFilterDrawer,
  EzModal,
  EzMultiSelect,
  EzPageHeader,
  EzPageLayout,
  EzSpinner,
  EzTabs,
  EzTextArea,
  EzTextEdit,
  EzTextInput,
} from '../components/ds';
import { applyDynamicFilters } from '../components/ds/EzDynamicFilter';
import type { EzDynamicFilterField, EzDynamicFilterRule } from '../components/ds/EzDynamicFilter';
import { ActiveTag } from '../components/ActiveTag';
import { OrganizationDeleteDialog, type OrganizationDeleteResult } from '../components/organizations/OrganizationDeleteDialog';
import { formatCnpj, formatCpf } from '../lib/documents';
import { useUserScreenConfig } from '../hooks/useUserScreenConfig';

interface OrganizationAddress {
  id: string;
  zipCode?: string | null;
  street?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  complement?: string | null;
}

interface OrganizationContact {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  type?: string | null;
}

interface ServiceDeskRef {
  id: string;
  name: string;
}

interface AgentGroup {
  id: string;
  name: string;
  active: boolean;
  members: { id: string; name: string; email: string }[];
}

interface Organization {
  id: string;
  name: string;
  legalName?: string | null;
  cnpj?: string | null;
  cpf?: string | null;
  documentType?: 'CNPJ' | 'CPF' | null;
  municipalRegistration?: string | null;
  stateRegistration?: string | null;
  active?: boolean;
  serviceType?: string | null;
  healthStatus?: string | null;
  workFolder?: string | null;
  notes?: string | null;
  visibleToClients?: boolean;
  quarterlyBilling?: boolean;
  billingEmails?: string | null;
  billingDueDay?: number | null;
  billingMethod?: string | null;
  billingNotes?: string | null;
  _count?: { users: number };
}

interface OrganizationDetail extends Organization {
  users: User[];
  addresses: OrganizationAddress[];
  contacts: OrganizationContact[];
  serviceDesks: ServiceDeskRef[];
  agentGroups: AgentGroup[];
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string | null;
}

interface CnpjLookupResult {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  address: {
    zipCode: string | null;
    street: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    complement: string | null;
  };
}

interface GeneralDraft {
  legalName: string;
  name: string;
}

interface PendingConfirm {
  title: string;
  message: string;
  variant: 'warning' | 'danger';
  onConfirm: () => void;
}

/** Mensagem da API para o usuário: lista do ValidationPipe junta; 5xx (texto técnico em inglês) cai no fallback. */
function apiErrorMessage(err: unknown, fallback: string): string {
  const response = (err as { response?: { status?: number; data?: { message?: string | string[] } } }).response;
  const message = Array.isArray(response?.data?.message) ? response.data.message.join(' ') : response?.data?.message;
  return message && (response?.status ?? 0) < 500 ? message : fallback;
}

/** DMTE-559: 409 do cadastro/edição de CNPJ (ou CPF) repetido vira pop-up; devolve a mensagem da API ou null. */
function duplicateDocumentMessage(err: unknown): string | null {
  const response = (err as { response?: { status?: number; data?: { message?: string } } }).response;
  return response?.status === 409 && response.data?.message ? response.data.message : null;
}

const orgFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  legalName: z.string().trim().optional(),
  documentType: z.enum(['CNPJ', 'CPF']).optional(),
  cnpj: z.string().trim().optional(),
  cpf: z.string().trim().optional(),
  municipalRegistration: z.string().trim().optional(),
  stateRegistration: z.string().trim().optional(),
  workFolder: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  visibleToClients: z.boolean().optional(),
  quarterlyBilling: z.boolean().optional(),
  billingEmails: z.string().trim().optional(),
  billingDueDay: z.string().refine(
    (val) => !val || (!isNaN(Number(val)) && Number.isInteger(Number(val)) && Number(val) >= 1 && Number(val) <= 31),
    { message: 'Dia de vencimento deve ser entre 1 e 31' },
  ).optional(),
  billingMethod: z.string().optional(),
  billingNotes: z.string().trim().optional(),
}).superRefine((values, ctx) => {
  // DMTE-559: CNPJ obrigatório no cadastro de empresa (PF informa CPF).
  if (values.documentType === 'CPF') return;
  const digits = (values.cnpj ?? '').replace(/\D/g, '');
  if (digits.length === 14) return;
  ctx.addIssue({ code: 'custom', path: ['cnpj'], message: digits ? 'CNPJ deve ter 14 dígitos' : 'CNPJ é obrigatório' });
});

type OrgFormValues = z.infer<typeof orgFormSchema>;

const addressFormSchema = z.object({
  zipCode: z.string().trim().optional(),
  street: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  complement: z.string().trim().optional(),
});

type AddressFormValues = z.infer<typeof addressFormSchema>;

const contactFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  type: z.string().trim().optional(),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

const agentGroupFormSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
});

type AgentGroupFormValues = z.infer<typeof agentGroupFormSchema>;

// Campos filtráveis dinamicamente (um por coluna da grade) - padrão Sankhya.
const ORG_FILTER_FIELDS: EzDynamicFilterField[] = [
  { id: 'name', label: 'Nome', getValue: (o: Organization) => o.name },
  { id: 'legalName', label: 'Razão Social', getValue: (o: Organization) => o.legalName },
  {
    id: 'document',
    label: 'CPF / CNPJ',
    getValue: (o: Organization) => (o.documentType === 'CPF' ? o.cpf : o.cnpj),
  },
  {
    id: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'Ativo', value: 'Ativo' },
      { label: 'Inativo', value: 'Inativo' },
    ],
    getValue: (o: Organization) => (o.active === false ? 'Inativo' : 'Ativo'),
  },
  { id: 'clientes', label: 'Usuários', type: 'number', getValue: (o: Organization) => o._count?.users ?? 0 },
  { id: 'stateRegistration', label: 'Inscrição Estadual', getValue: (o: Organization) => o.stateRegistration },
  { id: 'municipalRegistration', label: 'Inscrição Municipal', getValue: (o: Organization) => o.municipalRegistration },
  { id: 'workFolder', label: 'Pasta de Trabalho', getValue: (o: Organization) => o.workFolder },
  { id: 'serviceType', label: 'Perfil', getValue: (o: Organization) => o.serviceType },
  { id: 'healthStatus', label: 'Saúde', getValue: (o: Organization) => o.healthStatus },
];

type DetailTab = 'general' | 'users' | 'resources' | 'relationships' | 'billing';

export function OrganizationsPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';

  // Tiflux-parity (#57): padrão Sankhya de alternância Modo Lista / Modo
  // Formulário (EzEntityToolbar), substituindo o antigo modal único.
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [detailOrgId, setDetailOrgId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('general');
  const [cnpjLookupError, setCnpjLookupError] = useState<string | null>(null);
  // ORG-01/ORG-03 (#463): confirmação compartilhada (inativar cliente e remover endereço, contato ou grupo).
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  // ORG-04 (#463): Razão Social e Nome Fantasia editam um rascunho local; só o botão Salvar envia o PATCH.
  const [generalDraft, setGeneralDraft] = useState<GeneralDraft | null>(null);
  const [generalErrors, setGeneralErrors] = useState<Partial<Record<keyof GeneralDraft, string>>>({});
  const [generalSaveError, setGeneralSaveError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<{ serviceType: string; healthStatus: string } | null>(null);
  const [billingDraft, setBillingDraft] = useState<{
    quarterlyBilling?: boolean;
    billingEmails?: string;
    billingDueDay?: number | string;
    billingMethod?: string;
    billingNotes?: string;
  } | null>(null);
  const [linkDeskId, setLinkDeskId] = useState<string>('');
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<(string | number)[]>([]);

  // Sankhya Parity (br.com.sankhya.core.cad.parceiros): toolbar, drawer, personalização por usuário
  const {
    config: screenConfig,
    setColumnVisibility,
    setColumnOrder,
    setDensity,
    setFormLayout,
    saveFilter,
    deleteFilter,
    restoreDefaults,
  } = useUserScreenConfig('organizations', {
    grid: {
      columnVisibility: {
        legalName: true,
        document: true,
        stateRegistration: false,
        municipalRegistration: false,
        workFolder: false,
        serviceType: false,
        healthStatus: false,
      },
      density: 'compact',
    },
    form: {
      layout: 'CASCADE',
    },
    viewMode: 'GRID',
  });

  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [activeSavedFilterId, setActiveSavedFilterId] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [filterDocType, setFilterDocType] = useState<'ALL' | 'CNPJ' | 'CPF'>('ALL');
  const [dynamicRules, setDynamicRules] = useState<EzDynamicFilterRule[]>([]);
  const [isScreenConfigModalOpen, setIsScreenConfigModalOpen] = useState(false);
  const [screenConfigInitialTab, setScreenConfigInitialTab] = useState<'grid' | 'form'>('grid');
  const [selectedOrgs, setSelectedOrgs] = useState<Organization[]>([]);
  const [deleteTargets, setDeleteTargets] = useState<Organization[] | null>(null);
  // A grade guarda a seleção por posição da linha; sem falha, remontá-la limpa a seleção das linhas que saíram da lista.
  const [gridKey, setGridKey] = useState(0);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [duplicateDocument, setDuplicateDocument] = useState<string | null>(null);
  const duplicateTitle = `${duplicateDocument?.includes('CPF') ? 'CPF' : 'CNPJ'} já cadastrado`;
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Modal para cadastro automático via CNPJ (Sankhya / Receita Federal)
  const [isCnpjModalOpen, setIsCnpjModalOpen] = useState(false);
  const [cnpjModalInput, setCnpjModalInput] = useState('');
  const [cnpjModalError, setCnpjModalError] = useState<string | null>(null);
  const [isLookingUpCnpjModal, setIsLookingUpCnpjModal] = useState(false);
  // CNPJ e Razão Social são dados oficiais da Receita Federal: padrão Sankhya trava
  // esses campos após a busca, exigindo "Editar manualmente" para sobrescrevê-los.
  const [isCnpjDataLocked, setIsCnpjDataLocked] = useState(false);

  const { data: orgs, isLoading: isLoadingOrgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data } = await api.get<Organization[]>('/organizations');
      return data;
    },
    enabled: isAdmin,
  });

  const { data: usersList, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get<User[]>('/users');
      return data;
    },
    enabled: isAdmin,
  });

  const { data: serviceDesks } = useQuery({
    queryKey: ['service-desks', 'all-for-org-link'],
    queryFn: async () => {
      const { data } = await api.get<ServiceDeskRef[]>('/service-desks');
      return data;
    },
    enabled: isAdmin && mode === 'form' && !!detailOrgId,
  });

  const { data: orgDetail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['organizations', detailOrgId],
    queryFn: async () => {
      const { data } = await api.get<OrganizationDetail>(`/organizations/${detailOrgId}`);
      return data;
    },
    enabled: isAdmin && !!detailOrgId,
  });

  const { register, handleSubmit, reset, setValue, getValues, watch, formState: { errors } } = useForm<OrgFormValues>({
    resolver: zodResolver(orgFormSchema),
    defaultValues: {
      name: '', legalName: '', documentType: 'CNPJ', cnpj: '', cpf: '',
      municipalRegistration: '', stateRegistration: '', workFolder: '', notes: '',
      visibleToClients: true, quarterlyBilling: false,
    },
  });

  const documentType = watch('documentType');

  const {
    register: registerAddress,
    handleSubmit: handleAddressSubmit,
    reset: resetAddressForm,
    formState: { errors: addressErrors },
  } = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: { zipCode: '', street: '', neighborhood: '', city: '', state: '', complement: '' },
  });

  const {
    register: registerContact,
    handleSubmit: handleContactSubmit,
    reset: resetContactForm,
    formState: { errors: contactErrors },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { name: '', email: '', phone: '', type: '' },
  });

  const {
    register: registerAgentGroup,
    handleSubmit: handleAgentGroupSubmit,
    reset: resetAgentGroupForm,
    formState: { errors: agentGroupErrors },
  } = useForm<AgentGroupFormValues>({
    resolver: zodResolver(agentGroupFormSchema),
    defaultValues: { name: '' },
  });

  const pendingAddressRef = useRef<AddressFormValues | null>(null);

  const createMutation = useMutation({
    mutationFn: async (values: OrgFormValues) => {
      const payload = {
        ...values,
        // DMTE-554: documento em branco não vai à API; '' colide na coluna única com outro cliente sem documento.
        cnpj: values.cnpj || undefined,
        cpf: values.cpf || undefined,
        billingDueDay: values.billingDueDay ? parseInt(values.billingDueDay, 10) : undefined,
      };
      const { data } = await api.post<Organization>('/organizations', payload);
      const pendingAddress = pendingAddressRef.current;
      pendingAddressRef.current = null;
      if (pendingAddress && (pendingAddress.zipCode || pendingAddress.street)) {
        try {
          await api.post(`/organizations/${data.id}/addresses`, pendingAddress);
        } catch {
          // endereço é complementar: não bloqueia o cadastro
        }
      }
      return data;
    },
    onMutate: () => setCreateError(null),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      reset();
      setMode('list');
      openDetail(data.id);
    },
    onError: (err) => {
      const duplicate = duplicateDocumentMessage(err);
      if (duplicate) setDuplicateDocument(duplicate);
      else setCreateError(apiErrorMessage(err, 'Não foi possível cadastrar o cliente. Tente novamente.'));
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async (values: Partial<Organization>) => {
      const { data } = await api.patch<Organization>(`/organizations/${detailOrgId}`, values);
      return data;
    },
    onMutate: () => setInlineError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
    },
    onError: (err) => setInlineError(apiErrorMessage(err, 'Não foi possível salvar a alteração.')),
  });

  // ORG-02 (#463): mutações do detalhe do cliente mostram a mensagem da API no alerta da página.
  const showOperationError = (err: unknown) =>
    setInlineError(apiErrorMessage(err, 'Não foi possível concluir a operação. Tente novamente.'));

  const saveGeneralMutation = useMutation({
    mutationFn: async (values: Partial<GeneralDraft>) => {
      const { data } = await api.patch<Organization>(`/organizations/${detailOrgId}`, values);
      return data;
    },
    onMutate: () => setGeneralSaveError(null),
    onSuccess: (_data, values) => {
      // O rascunho segue o que foi salvo (sem espaços nas pontas) e o cache já reflete o cadastro antes da releitura.
      setGeneralDraft((prev) => (prev ? { ...prev, ...values } : prev));
      queryClient.setQueryData<OrganizationDetail>(['organizations', detailOrgId], (old) => (old ? { ...old, ...values } : old));
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
    },
    onError: (err) => setGeneralSaveError(apiErrorMessage(err, 'Não foi possível salvar as alterações. Tente novamente.')),
  });

  const attachUserMutation = useMutation({
    mutationFn: async ({ userId, orgId }: { userId: string; orgId: string | null }) => {
      await api.patch(`/users/${userId}`, { organizationId: orgId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
    },
    onError: showOperationError,
  });

  const cnpjLookupMutation = useMutation({
    mutationFn: async (cnpj: string) => {
      const { data } = await api.get<CnpjLookupResult>('/organizations/cnpj-lookup', { params: { cnpj } });
      return data;
    },
    onSuccess: (data) => {
      setCnpjLookupError(null);
      setValue('documentType', 'CNPJ');
      setValue('cnpj', data.cnpj);
      setValue('legalName', data.legalName);
      if (data.tradeName) setValue('name', data.tradeName);
      setIsCnpjDataLocked(true);
    },
    onError: () => {
      setCnpjLookupError('CNPJ não encontrado ou inválido. Verifique e tente novamente.');
    },
  });

  const inlinePatchMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Organization> }) => {
      const res = await api.patch<Organization>(`/organizations/${id}`, data);
      return res.data;
    },
    onMutate: () => setInlineError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      if (detailOrgId) {
        void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
      }
    },
    onError: (err) => {
      const duplicate = duplicateDocumentMessage(err);
      if (duplicate) {
        setDuplicateDocument(duplicate);
        return;
      }
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      setInlineError(message ?? 'Não foi possível salvar a alteração.');
    },
  });

  const handleCnpjModalSubmit = async () => {
    const rawDigits = cnpjModalInput.replace(/\D/g, '');
    if (rawDigits.length !== 14) {
      setCnpjModalError('CNPJ deve conter 14 dígitos.');
      return;
    }
    setIsLookingUpCnpjModal(true);
    setCnpjModalError(null);
    try {
      const { data } = await api.get<CnpjLookupResult>('/organizations/cnpj-lookup', {
        params: { cnpj: rawDigits },
      });
      reset();
      setValue('documentType', 'CNPJ');
      setValue('cnpj', data.cnpj);
      setValue('legalName', data.legalName);
      setValue('name', data.tradeName || data.legalName);
      if (data.address) {
        pendingAddressRef.current = {
          zipCode: data.address.zipCode ?? '',
          street: data.address.street ?? '',
          neighborhood: data.address.neighborhood ?? '',
          city: data.address.city ?? '',
          state: data.address.state ?? '',
          complement: data.address.complement ?? '',
        };
        resetAddressForm({
          zipCode: data.address.zipCode ?? '',
          street: data.address.street ?? '',
          neighborhood: data.address.neighborhood ?? '',
          city: data.address.city ?? '',
          state: data.address.state ?? '',
          complement: data.address.complement ?? '',
        });
      }
      setIsCnpjModalOpen(false);
      setDetailOrgId(null);
      setIsCnpjDataLocked(true);
      setMode('form');
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setCnpjModalError(
        status === 404 || status === 400
          ? 'CNPJ não encontrado ou inválido na Receita Federal.'
          : 'Não foi possível consultar a Receita Federal agora. Tente novamente em instantes.',
      );
    } finally {
      setIsLookingUpCnpjModal(false);
    }
  };

  const addAddressMutation = useMutation({
    mutationFn: async (values: AddressFormValues) => {
      const { data } = await api.post(`/organizations/${detailOrgId}/addresses`, values);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
      resetAddressForm();
    },
    onError: showOperationError,
  });

  const removeAddressMutation = useMutation({
    mutationFn: async (addressId: string) => {
      await api.delete(`/organizations/${detailOrgId}/addresses/${addressId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
    },
    onError: showOperationError,
  });

  const addContactMutation = useMutation({
    mutationFn: async (values: ContactFormValues) => {
      const { data } = await api.post(`/organizations/${detailOrgId}/contacts`, values);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
      resetContactForm();
    },
    onError: showOperationError,
  });

  const removeContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      await api.delete(`/organizations/${detailOrgId}/contacts/${contactId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
    },
    onError: showOperationError,
  });

  // Tiflux-parity (#57): aba "Relacionamentos" — Mesa<->Cliente N:N.
  const linkDeskMutation = useMutation({
    mutationFn: async (deskId: string) => {
      await api.post(`/organizations/${detailOrgId}/service-desks/${deskId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
      setLinkDeskId('');
    },
    onError: showOperationError,
  });

  const unlinkDeskMutation = useMutation({
    mutationFn: async (deskId: string) => {
      await api.delete(`/organizations/${detailOrgId}/service-desks/${deskId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
    },
    onError: showOperationError,
  });

  // Tiflux-parity (#57): Grupo de Atendentes — entidade por cliente.
  const createAgentGroupMutation = useMutation({
    mutationFn: async (values: AgentGroupFormValues) => {
      const { data } = await api.post(`/organizations/${detailOrgId}/agent-groups`, {
        ...values,
        memberIds: newGroupMemberIds,
      });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
      resetAgentGroupForm();
      setNewGroupMemberIds([]);
    },
    onError: showOperationError,
  });

  const removeAgentGroupMutation = useMutation({
    mutationFn: async (agentGroupId: string) => {
      await api.delete(`/organizations/${detailOrgId}/agent-groups/${agentGroupId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
    },
    onError: showOperationError,
  });

  const openDetail = (orgId: string) => {
    const idx = filteredOrgs.findIndex((o) => o.id === orgId);
    if (idx !== -1) {
      setFocusedIndex(idx);
      setSelectedOrgs([filteredOrgs[idx]]);
    }
    setDetailTab('general');
    setDetailOrgId(orgId);
    setProfileDraft(null);
    setGeneralDraft(null);
    setGeneralErrors({});
    setGeneralSaveError(null);
    saveGeneralMutation.reset();
    setBillingDraft(null);
    setMode('form');
  };

  const backToList = () => {
    setMode('list');
    setDetailOrgId(null);
  };

  if (orgDetail && profileDraft === null) {
    setProfileDraft({
      serviceType: orgDetail.serviceType ?? '',
      healthStatus: orgDetail.healthStatus ?? '',
    });
  }

  if (orgDetail && generalDraft === null) {
    setGeneralDraft({ legalName: orgDetail.legalName ?? '', name: orgDetail.name ?? '' });
  }
  const generalDirty =
    !!orgDetail && !!generalDraft &&
    (generalDraft.legalName !== (orgDetail.legalName ?? '') || generalDraft.name !== (orgDetail.name ?? ''));

  const saveGeneral = () => {
    if (!orgDetail || !generalDraft) return;
    const changes: Partial<GeneralDraft> = {};
    const errors: Partial<Record<keyof GeneralDraft, string>> = {};
    const fields: [keyof GeneralDraft, string, string][] = [
      ['legalName', orgDetail.legalName ?? '', 'Informe a Razão Social.'],
      ['name', orgDetail.name ?? '', 'Informe o Nome Fantasia.'],
    ];
    for (const [field, saved, emptyMessage] of fields) {
      if (generalDraft[field] === saved) continue;
      const value = generalDraft[field].trim();
      if (!value) errors[field] = emptyMessage;
      else if (value !== saved) changes[field] = value;
    }
    setGeneralErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (Object.keys(changes).length === 0) {
      setGeneralDraft({ legalName: orgDetail.legalName ?? '', name: orgDetail.name ?? '' });
      return;
    }
    saveGeneralMutation.mutate(changes);
  };

  const linkedDeskIds = new Set((orgDetail?.serviceDesks ?? []).map((d) => d.id));
  const availableDesksToLink = (serviceDesks ?? []).filter((d) => !linkedDeskIds.has(d.id));

  const userOptions = (usersList ?? []).map((u) => ({ label: `${u.name} (${u.email})`, value: u.id }));

  const orgColumns = useMemo<ColumnDef<Organization>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nome',
        size: 165,
        meta: { truncate: true },
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Abrir cadastro de ${row.original.name}`}
            onClick={() => openDetail(row.original.id)}
            className="block max-w-full truncate text-left text-xs font-medium text-brand-700 hover:underline cursor-pointer"
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: 'legalName',
        header: 'Razão Social',
        size: 240,
        meta: { truncate: true, hideBelowSm: true },
        cell: ({ row }) => (
          <EzTextEdit
            value={row.original.legalName || ''}
            placeholder="Razão Social"
            className="max-w-full text-xs text-gray-900 [&>span]:truncate"
            onChange={(val) => {
              if (val !== (row.original.legalName || '')) {
                inlinePatchMutation.mutate({ id: row.original.id, data: { legalName: val.trim() } });
              }
            }}
          />
        ),
      },
      {
        id: 'document',
        header: 'CPF / CNPJ',
        size: 180,
        meta: { hideBelowSm: true },
        cell: ({ row }) => {
          const isCpf = row.original.documentType === 'CPF';
          const doc = isCpf ? row.original.cpf : row.original.cnpj;
          return (
            <EzTextEdit
              value={doc ? (isCpf ? formatCpf(doc) : formatCnpj(doc)) : ''}
              placeholder={isCpf ? 'CPF' : 'CNPJ'}
              className="font-mono text-xs text-gray-700 whitespace-nowrap"
              onChange={(val) => {
                const digits = val.replace(/\D/g, '');
                if (digits !== (doc || '').replace(/\D/g, '')) {
                  inlinePatchMutation.mutate({
                    id: row.original.id,
                    data: isCpf ? { cpf: digits } : { cnpj: digits },
                  });
                }
              }}
            />
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        size: 115,
        accessorFn: (org) => (org.active === false ? 'Inativo' : 'Ativo'),
        cell: ({ row }) => <ActiveTag active={row.original.active !== false} />,
      },
      {
        id: 'clientes',
        header: 'Usuários',
        size: 90,
        meta: { align: 'right' },
        cell: ({ row }) => <span className="text-xs text-gray-500">{row.original._count?.users || 0}</span>,
      },
      {
        accessorKey: 'stateRegistration',
        header: 'Inscrição Estadual',
        cell: ({ row }) => (
          <EzTextEdit
            value={row.original.stateRegistration || ''}
            placeholder="IE"
            className="text-xs text-gray-600"
            onChange={(val) => {
              if (val !== (row.original.stateRegistration || '')) {
                inlinePatchMutation.mutate({ id: row.original.id, data: { stateRegistration: val.trim() } });
              }
            }}
          />
        ),
      },
      {
        accessorKey: 'municipalRegistration',
        header: 'Inscrição Municipal',
        cell: ({ row }) => (
          <EzTextEdit
            value={row.original.municipalRegistration || ''}
            placeholder="IM"
            className="text-xs text-gray-600"
            onChange={(val) => {
              if (val !== (row.original.municipalRegistration || '')) {
                inlinePatchMutation.mutate({ id: row.original.id, data: { municipalRegistration: val.trim() } });
              }
            }}
          />
        ),
      },
      {
        accessorKey: 'workFolder',
        header: 'Pasta de Trabalho',
        cell: ({ row }) => (
          <EzTextEdit
            value={row.original.workFolder || ''}
            placeholder="/pasta"
            className="text-xs font-mono text-gray-500"
            onChange={(val) => {
              if (val !== (row.original.workFolder || '')) {
                inlinePatchMutation.mutate({ id: row.original.id, data: { workFolder: val.trim() } });
              }
            }}
          />
        ),
      },
      {
        accessorKey: 'serviceType',
        header: 'Perfil',
        cell: ({ row }) => (
          <EzTextEdit
            value={row.original.serviceType || ''}
            placeholder="Perfil"
            className="text-xs text-gray-600"
            onChange={(val) => {
              if (val !== (row.original.serviceType || '')) {
                inlinePatchMutation.mutate({ id: row.original.id, data: { serviceType: val.trim() } });
              }
            }}
          />
        ),
      },
      {
        accessorKey: 'healthStatus',
        header: 'Saúde',
        cell: ({ row }) => (
          <EzTextEdit
            value={row.original.healthStatus || ''}
            placeholder="Saúde"
            className="text-xs text-gray-600"
            onChange={(val) => {
              if (val !== (row.original.healthStatus || '')) {
                inlinePatchMutation.mutate({ id: row.original.id, data: { healthStatus: val.trim() } });
              }
            }}
          />
        ),
      },
    ],
    []
  );

  const screenConfigColumns = useMemo(() => {
    return orgColumns.map((c) => {
      const colId = (c as any).accessorKey ?? c.id ?? '';
      const label = typeof c.header === 'string' ? c.header : colId;
      const isVisible = screenConfig.grid.columnVisibility[colId] !== false;
      return { id: colId, label, isVisible };
    });
  }, [orgColumns, screenConfig.grid.columnVisibility]);

  const filteredOrgs = useMemo(() => {
    const base = (orgs ?? []).filter((org) => {
      if (filterStatus === 'ACTIVE' && org.active === false) return false;
      if (filterStatus === 'INACTIVE' && org.active !== false) return false;
      if (filterDocType === 'CNPJ' && org.documentType === 'CPF') return false;
      if (filterDocType === 'CPF' && org.documentType !== 'CPF') return false;
      if (filterSearch.trim()) {
        const query = filterSearch.toLowerCase().trim();
        const matchesName = org.name.toLowerCase().includes(query);
        const matchesLegal = org.legalName?.toLowerCase().includes(query);
        const matchesCnpj = org.cnpj?.includes(query);
        const matchesCpf = org.cpf?.includes(query);
        if (!matchesName && !matchesLegal && !matchesCnpj && !matchesCpf) return false;
      }
      return true;
    });
    return applyDynamicFilters(base, dynamicRules, ORG_FILTER_FIELDS);
  }, [orgs, filterStatus, filterDocType, filterSearch, dynamicRules]);

  const handlePrevious = () => {
    if (focusedIndex > 0) {
      const newIdx = focusedIndex - 1;
      setFocusedIndex(newIdx);
      const target = filteredOrgs[newIdx];
      if (target) {
        setSelectedOrgs([target]);
        if (mode === 'form' && detailOrgId) {
          openDetail(target.id);
        }
      }
    }
  };

  const handleNext = () => {
    if (focusedIndex < filteredOrgs.length - 1) {
      const newIdx = focusedIndex + 1;
      setFocusedIndex(newIdx);
      const target = filteredOrgs[newIdx];
      if (target) {
        setSelectedOrgs([target]);
        if (mode === 'form' && detailOrgId) {
          openDetail(target.id);
        }
      }
    }
  };

  // DMTE-560: a lixeira exclui de verdade, depois de consultar os vínculos no pop-up do DS.
  const handleDelete = () => {
    const targets = selectedOrgs.length > 0 ? selectedOrgs : (detailOrgId && orgDetail ? [orgDetail] : []);
    if (targets.length > 0) setDeleteTargets(targets);
  };

  const handleDeleted = ({ deleted, failed }: OrganizationDeleteResult) => {
    setSelectedOrgs((current) => current.filter((org) => failed.includes(org.id)));
    if (failed.length === 0) setGridKey((key) => key + 1);
    if (detailOrgId && deleted.includes(detailOrgId)) {
      setDetailOrgId(null);
      setMode('list');
    }
    void queryClient.invalidateQueries({ queryKey: ['organizations'] });
  };

  const handleClone = () => {
    const active = selectedOrgs[0] ?? filteredOrgs[focusedIndex];
    if (!active) return;
    setValue('name', `${active.name} (Cópia)`);
    setValue('legalName', active.legalName ?? '');
    setValue('documentType', active.documentType ?? 'CNPJ');
    setValue('workFolder', active.workFolder ?? '');
    setDetailOrgId(null);
    setIsCnpjDataLocked(false);
    setMode('form');
  };

  const toolbarActions = [
    {
      label: 'Cadastrar manualmente',
      icon: FilePlus,
      onClick: () => {
        reset();
        setCreateError(null);
        setDetailOrgId(null);
        setIsCnpjDataLocked(false);
        setMode('form');
      },
    },
    {
      label: 'Cadastrar por CNPJ',
      icon: Plus,
      onClick: () => {
        setCnpjModalInput('');
        setCnpjModalError(null);
        setIsCnpjModalOpen(true);
      },
    },
    {
      label: 'Consultar CNPJ na Receita',
      icon: Search,
      onClick: () => {
        const active = selectedOrgs[0] ?? filteredOrgs[focusedIndex];
        if (active?.cnpj) {
          cnpjLookupMutation.mutate(active.cnpj);
        }
      },
    },
    {
      label: 'Atualizar dados pela Receita',
      icon: RefreshCw,
      onClick: () => {
        const active = selectedOrgs[0] ?? filteredOrgs[focusedIndex];
        if (!active?.cnpj) return;
        api
          .get<CnpjLookupResult>('/organizations/cnpj-lookup', { params: { cnpj: active.cnpj } })
          .then(({ data }) =>
            inlinePatchMutation.mutate({
              id: active.id,
              data: { legalName: data.legalName, ...(data.tradeName ? { name: data.tradeName } : {}) },
            }),
          )
          .catch(() => setCnpjLookupError('CNPJ não encontrado ou inválido. Verifique e tente novamente.'));
      },
    },
  ];

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-[18px] font-semibold text-gray-900">Clientes</h1>
        <p className="text-sm text-gray-500">Somente administradores podem gerenciar empresas.</p>
      </div>
    );
  }

  return (
    <EzPageLayout
      header={
        <EzPageHeader
          title="Clientes"
          showBackButton={mode === 'form'}
          onBack={backToList}
        />
      }
    >
      <div className="space-y-6">
        {isLoadingOrgs ? (
          <EzSpinner label="Carregando…" />
        ) : (
          <div className="bg-white rounded-[10px] border border-gray-200 overflow-hidden shadow-xs flex flex-col">
            {/* Sankhya Standard Entity Toolbar */}
            <EzEntityToolbar
              viewMode={mode === 'list' ? 'GRID' : 'FORM'}
              onToggleViewMode={(nextMode) => {
                if (nextMode === 'FORM') {
                  const active = selectedOrgs[0] ?? filteredOrgs[focusedIndex] ?? filteredOrgs[0];
                  if (active) {
                    openDetail(active.id);
                  } else {
                    reset();
                    setDetailOrgId(null);
                    setMode('form');
                  }
                } else {
                  backToList();
                }
              }}
              isFilterOpen={isFilterPanelOpen}
              onToggleFilter={() => setIsFilterPanelOpen((prev) => !prev)}
              hasPrevious={focusedIndex > 0}
              onPrevious={handlePrevious}
              hasNext={focusedIndex < filteredOrgs.length - 1}
              onNext={handleNext}
              selectedCount={selectedOrgs.length || (detailOrgId ? 1 : 0)}
              onDelete={handleDelete}
              onClone={handleClone}
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: ['organizations'] });
                if (detailOrgId) {
                  void queryClient.invalidateQueries({ queryKey: ['organizations', detailOrgId] });
                }
              }}
              onOpenGridConfig={() => {
                setScreenConfigInitialTab('grid');
                setIsScreenConfigModalOpen(true);
              }}
              onOpenFormConfig={() => {
                setScreenConfigInitialTab('form');
                setIsScreenConfigModalOpen(true);
              }}
              onOpenScreenConfig={() => {
                setScreenConfigInitialTab(mode === 'form' ? 'form' : 'grid');
                setIsScreenConfigModalOpen(true);
              }}
              recordCountText={
                mode === 'form' && detailOrgId
                  ? `${focusedIndex >= 0 ? focusedIndex + 1 : 1} de ${filteredOrgs.length}`
                  : undefined
              }
              actions={toolbarActions}
            />

            {inlineError && (
              <EzAlert variant="error" onClose={() => setInlineError(null)}>
                {inlineError}
              </EzAlert>
            )}

            {mode === 'list' && (
              <div className="relative flex flex-1 overflow-hidden min-h-[420px]">
                {/* Lateral Filter Drawer com Filtros Dinâmicos e Filtros Salvos */}
                <EzFilterDrawer
                  isOpen={isFilterPanelOpen}
                  onClose={() => setIsFilterPanelOpen(false)}
                  onClear={() => {
                    setFilterSearch('');
                    setFilterStatus('ALL');
                    setFilterDocType('ALL');
                    setDynamicRules([]);
                    setActiveSavedFilterId(null);
                  }}
                  title="Filtros de Clientes"
                  savedFilters={screenConfig.savedFilters}
                  activeSavedFilterId={activeSavedFilterId}
                  onApplySavedFilter={(sf) => {
                    setActiveSavedFilterId(sf.id);
                    if (sf.criteria.search !== undefined) setFilterSearch(sf.criteria.search);
                    if (sf.criteria.status !== undefined) setFilterStatus(sf.criteria.status);
                    if (sf.criteria.docType !== undefined) setFilterDocType(sf.criteria.docType);
                    setDynamicRules(Array.isArray(sf.criteria.rules) ? sf.criteria.rules : []);
                  }}
                  onSaveCurrentFilter={(name) => {
                    saveFilter(name, {
                      search: filterSearch,
                      status: filterStatus,
                      docType: filterDocType,
                      rules: dynamicRules,
                    });
                  }}
                  onDeleteSavedFilter={(id) => {
                    deleteFilter(id);
                    if (activeSavedFilterId === id) setActiveSavedFilterId(null);
                  }}
                >
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="filter-search-input" className="text-xs font-medium text-gray-700">
                        Buscar Parceiro
                      </label>
                      <EzTextInput
                        id="filter-search-input"
                        placeholder="Nome, Razão Social, CNPJ…"
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="filter-status-select" className="text-xs font-medium text-gray-700">
                        Status
                      </label>
                      <EzComboBox
                        id="filter-status-select"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                      >
                        <option value="ALL">Todos os status</option>
                        <option value="ACTIVE">Apenas Ativos</option>
                        <option value="INACTIVE">Apenas Inativos</option>
                      </EzComboBox>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="filter-doctype-select" className="text-xs font-medium text-gray-700">
                        Tipo de Documento
                      </label>
                      <EzComboBox
                        id="filter-doctype-select"
                        value={filterDocType}
                        onChange={(e) => setFilterDocType(e.target.value as any)}
                      >
                        <option value="ALL">Todos os documentos</option>
                        <option value="CNPJ">Pessoa Jurídica (CNPJ)</option>
                        <option value="CPF">Pessoa Física (CPF)</option>
                      </EzComboBox>
                    </div>

                    <EzDynamicFilter
                      fields={ORG_FILTER_FIELDS}
                      rules={dynamicRules}
                      onChange={setDynamicRules}
                    />
                  </div>
                </EzFilterDrawer>

                {/* Grid Content */}
                <div data-testid="organizations-grid-content"
className="isolate flex-1 p-3 overflow-x-auto touch-pan-x touch-pan-y overscroll-x-contain min-w-0 flex flex-col">
                  {orgs?.length === 0 ? (
                    <div className="p-4">
                      <EzEmptyCard title="Nenhuma empresa cadastrada ainda." />
                    </div>
                  ) : (
                    <EzEntityGrid
                      tableLabel="Organizações"
                      key={gridKey}
                      columns={orgColumns}
                      data={filteredOrgs}
                      showRowNumbers
                      compactBelowSm
                      enableColumnGrouping={false}
                      selectable
                      showGridCornerMenu
                      enableColumnMenu
                      enableColumnFilters
                      zebraStriping
                      density={screenConfig.grid.density}
                      initialColumnVisibility={screenConfig.grid.columnVisibility}
                      showStatusBar={false}
                      enableColumnReorder
                      columnOrder={screenConfig.grid.columnOrder}
                      onColumnOrderChange={setColumnOrder}
                      pageSize={10}
                      onSelectionChange={(selected) => {
                        setSelectedOrgs(selected);
                        if (selected.length > 0) {
                          const idx = filteredOrgs.findIndex((o) => o.id === selected[0].id);
                          if (idx !== -1) setFocusedIndex(idx);
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {mode === 'form' && !detailOrgId && (
              <form
                onSubmit={handleSubmit((values) => createMutation.mutate(values))}
                noValidate
                className="p-5 space-y-5"
              >
                {createError && (
                  <EzAlert variant="error" onClose={() => setCreateError(null)}>
                    {createError}
                  </EzAlert>
                )}
                <div className="bg-white rounded-[8px] border border-gray-200 p-4 space-y-4">
                  <div className="border-b border-gray-100 pb-2.5 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Nova Empresa</h2>
                      <p className="text-xs text-gray-500">Preencha os dados cadastrais do cliente.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-6 gap-3.5">
                    <div className="md:col-span-2">
                      <EzComboBox
                        id="org-document-type"
                        label="Tipo de Documento"
                        {...register('documentType')}
                      >
                        <option value="CNPJ">CNPJ (Pessoa Jurídica)</option>
                        <option value="CPF">CPF (Pessoa Física)</option>
                      </EzComboBox>
                    </div>

                    {documentType === 'CPF' ? (
                      <div className="md:col-span-2">
                        <EzTextInput id="org-cpf" label="CPF" placeholder="000.000.000-00" {...register('cpf')} />
                      </div>
                    ) : (
                      <div className="md:col-span-2 flex items-end gap-2">
                        <div className="flex-1">
                          <EzTextInput
                            id="org-cnpj"
                            label="CNPJ"
                            placeholder="00.000.000/0000-00"
                            disabled={isCnpjDataLocked}
                            hasError={!!errors.cnpj}
                            message={errors.cnpj?.message}
                            {...register('cnpj')}
                          />
                        </div>
                        <EzButton
                          type="button"
                          variant="secondary"
                          leftIcon={Search}
                          disabled={cnpjLookupMutation.isPending || isCnpjDataLocked}
                          onClick={() => {
                            const cnpj = getValues('cnpj');
                            if (cnpj) cnpjLookupMutation.mutate(cnpj);
                          }}
                        >
                          Buscar CNPJ
                        </EzButton>
                      </div>
                    )}

                    <div className="md:col-span-2">
                      <EzTextInput id="org-work-folder" label="Pasta de Trabalho" {...register('workFolder')} />
                    </div>

                    <div className="md:col-span-3">
                      <EzTextInput
                        id="org-name"
                        label="Nome Fantasia"
                        hasError={!!errors.name}
                        message={errors.name?.message}
                        {...register('name')}
                      />
                    </div>

                    <div className="md:col-span-3 flex items-end gap-2">
                      <div className="flex-1">
                        <EzTextInput
                          id="org-legal-name"
                          label="Razão Social"
                          disabled={isCnpjDataLocked}
                          message={isCnpjDataLocked ? 'Dado oficial da Receita Federal — obtido via Buscar CNPJ.' : undefined}
                          {...register('legalName')}
                        />
                      </div>
                      {isCnpjDataLocked && (
                        <EzButton
                          type="button"
                          variant="tertiary"
                          size="small"
                          onClick={() => setIsCnpjDataLocked(false)}
                        >
                          Editar manualmente
                        </EzButton>
                      )}
                    </div>

                    <div className="md:col-span-3">
                      <EzTextInput id="org-state-registration" label="Inscrição Estadual" {...register('stateRegistration')} />
                    </div>
                    <div className="md:col-span-3">
                      <EzTextInput id="org-municipal-registration" label="Inscrição Municipal" {...register('municipalRegistration')} />
                    </div>
                  </div>

                  {cnpjLookupError && (
                    <EzAlert variant="error" onClose={() => setCnpjLookupError(null)}>
                      {cnpjLookupError}
                    </EzAlert>
                  )}
                </div>

                <div className="bg-white rounded-[8px] border border-gray-200 p-4 space-y-4">
                  <div className="border-b border-gray-100 pb-2.5">
                    <h3 className="text-sm font-semibold text-gray-900">Parâmetros & Faturamento</h3>
                    <p className="text-xs text-gray-500">Configurações de visibilidade, cobrança e observações do cliente.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    <EzTextInput id="org-billing-emails-create" label="E-mails de Faturamento" placeholder="ex: financeiro@cliente.com" {...register('billingEmails')} />
                    <EzTextInput id="org-billing-due-day-create" label="Dia de Vencimento" type="number" min="1" max="31" placeholder="ex: 10" {...register('billingDueDay')} />
                    <div className="flex flex-col justify-center space-y-2 pt-2">
                      <EzCheck id="org-visible" label="Visível para clientes" {...register('visibleToClients')} />
                      <EzCheck id="org-quarterly" label="Faturamento quarteirizado" {...register('quarterlyBilling')} />
                    </div>
                  </div>

                  <EzTextArea id="org-notes" label="Anotações" rows={3} {...register('notes')} />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <EzButton type="button" variant="tertiary" onClick={backToList}>
                    Cancelar
                  </EzButton>
                  <EzButton type="submit" disabled={createMutation.isPending}>
                    Cadastrar
                  </EzButton>
                </div>
              </form>
            )}

            {mode === 'form' && detailOrgId && (
              isLoadingDetail || !orgDetail ? (
                <div className="p-8">
                  <EzSpinner label="Carregando…" />
                </div>
              ) : (
                <div className="p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[18px] font-semibold text-gray-900">{orgDetail.name}</h2>
                    <div className="flex items-center gap-2 text-sm">
                      <EzCheck
                        id="org-active-toggle"
                        label="Cliente ativo"
                        checked={orgDetail.active !== false}
                        disabled={updateOrgMutation.isPending}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateOrgMutation.mutate({ active: true });
                            return;
                          }
                          setPendingConfirm({
                            title: 'Inativar cliente?',
                            message: `${orgDetail.name} deixará de constar como cliente ativo. Os usuários, as mesas e os tickets do cliente continuam cadastrados, mas revise-os antes de confirmar. Você pode reativar o cliente depois.`,
                            variant: 'warning',
                            onConfirm: () => updateOrgMutation.mutate({ active: false }),
                          });
                        }}
                      />
                    </div>
                  </div>

                  {/* Painel principal padronizado (Sankhya ERP Form Mode) */}
                  <div className="bg-white rounded-[8px] border border-gray-200 p-4 space-y-4">
                    <div className="border-b border-gray-100 pb-2.5 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Dados do Parceiro / Cliente</h3>
                        <p className="text-xs text-gray-500">Dados cadastrais principais do cliente.</p>
                      </div>
                      <div className="text-xs text-gray-400 font-mono">
                        ID: {orgDetail.id}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 text-sm">
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">Nome Fantasia</span>
                        <div className="text-gray-900 font-medium text-sm">{orgDetail.name || '—'}</div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">Razão Social</span>
                        <div className="text-gray-900 font-medium text-sm">{orgDetail.legalName || '—'}</div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">CPF/CNPJ</span>
                        <div className="text-gray-900 font-medium text-sm font-mono">
                          {orgDetail.documentType === 'CPF' ? (formatCpf(orgDetail.cpf) || '—') : (formatCnpj(orgDetail.cnpj) || '—')}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">Inscrição Estadual</span>
                        <div className="text-gray-900 font-medium text-sm">{orgDetail.stateRegistration || '—'}</div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">Inscrição Municipal</span>
                        <div className="text-gray-900 font-medium text-sm">{orgDetail.municipalRegistration || '—'}</div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">Recursos cadastrados</span>
                        <div className="text-gray-900 font-medium text-sm">-- / 0 disponíveis / 0 em uso</div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">Pasta de Trabalho</span>
                        <div className="text-gray-900 font-medium text-sm">{orgDetail.workFolder || '—'}</div>
                      </div>
                      <div className="flex items-center gap-2 pt-3">
                        <EzCheck
                          id="org-visible-toggle"
                          label="Visível para clientes"
                          checked={orgDetail.visibleToClients !== false}
                          disabled={updateOrgMutation.isPending}
                          onChange={(e) => updateOrgMutation.mutate({ visibleToClients: e.target.checked })}
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-gray-500">Agentes inteligentes</span>
                        <div className="text-gray-900 font-medium text-sm">-- / 0 disponíveis / 0 em uso</div>
                      </div>

                      <div className="col-span-1 md:col-span-2 space-y-1">
                        <span className="text-xs font-medium text-gray-500">Anotações</span>
                        <div className="text-gray-900 font-medium text-sm">{orgDetail.notes || '—'}</div>
                      </div>
                      <div className="flex items-center gap-2 pt-3">
                        <EzCheck
                          id="org-quarterly-toggle"
                          label="Faturamento quarteirizado"
                          checked={orgDetail.quarterlyBilling === true}
                          disabled={updateOrgMutation.isPending}
                          onChange={(e) => updateOrgMutation.mutate({ quarterlyBilling: e.target.checked })}
                        />
                      </div>
                    </div>
                  </div>

                  <EzTabs
                tabs={[
                  { id: 'general', label: 'Geral' },
                  { id: 'users', label: 'Usuários' },
                  { id: 'resources', label: 'Recursos' },
                  { id: 'relationships', label: 'Relacionamentos' },
                  { id: 'billing', label: 'Faturamento' },
                ]}
                activeTab={detailTab}
                onChange={(tabId) => setDetailTab(tabId as DetailTab)}
              />

              {detailTab === 'general' && (
                <div className="space-y-4">
                  <form
                    aria-label="Dados cadastrais do cliente"
                    noValidate
                    onSubmit={(e) => { e.preventDefault(); saveGeneral(); }}
                    className="space-y-3"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <EzTextInput
                        id="org-legal-name-edit"
                        label="Razão Social"
                        value={generalDraft?.legalName ?? ''}
                        hasError={!!generalErrors.legalName}
                        message={generalErrors.legalName}
                        onChange={(e) => {
                          setGeneralDraft((prev) => (prev ? { ...prev, legalName: e.target.value } : prev));
                          setGeneralErrors((prev) => ({ ...prev, legalName: undefined }));
                        }}
                      />
                      <EzTextInput
                        id="org-name-edit"
                        label="Nome Fantasia"
                        value={generalDraft?.name ?? ''}
                        hasError={!!generalErrors.name}
                        message={generalErrors.name}
                        onChange={(e) => {
                          setGeneralDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev));
                          setGeneralErrors((prev) => ({ ...prev, name: undefined }));
                        }}
                      />
                    </div>
                    {generalSaveError && (
                      <EzAlert variant="error" onClose={() => setGeneralSaveError(null)}>
                        {generalSaveError}
                      </EzAlert>
                    )}
                    <div className="flex items-center justify-end gap-3">
                      <span aria-live="polite" className="text-xs text-gray-600">
                        {saveGeneralMutation.isPending
                          ? 'Salvando…'
                          : generalDirty
                            ? 'Alterações não salvas'
                            : saveGeneralMutation.isSuccess
                              ? 'Salvo'
                              : null}
                      </span>
                      <EzButton
                        type="submit"
                        size="small"
                        label="Salvar alterações"
                        loading={saveGeneralMutation.isPending}
                        disabled={!generalDirty}
                        disabledReason="Nenhuma alteração para salvar."
                      />
                    </div>
                  </form>

                  <h4 className="text-sm font-semibold text-gray-900 pt-2">Perfil do Cliente</h4>
                  {profileDraft && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <EzComboBox
                          id="org-service-type"
                          label="Tipo de Atendimento"
                          value={profileDraft.serviceType}
                          onChange={(e) => setProfileDraft({ ...profileDraft, serviceType: e.target.value })}
                        >
                          <option value="">Sem dados</option>
                          <option value="SUPORTE">Suporte</option>
                          <option value="CONSULTORIA">Consultoria</option>
                          <option value="DESENVOLVIMENTO">Desenvolvimento</option>
                        </EzComboBox>
                        <EzComboBox
                          id="org-health-status"
                          label="Saúde"
                          value={profileDraft.healthStatus}
                          onChange={(e) => setProfileDraft({ ...profileDraft, healthStatus: e.target.value })}
                        >
                          <option value="">Sem dados</option>
                          <option value="SAUDAVEL">Saudável</option>
                          <option value="ATENCAO">Atenção</option>
                          <option value="RISCO">Risco</option>
                        </EzComboBox>
                      </div>
                      <div className="flex justify-end">
                        <EzButton
                          size="small"
                          disabled={updateOrgMutation.isPending}
                          onClick={() => updateOrgMutation.mutate(profileDraft)}
                        >
                          Salvar Perfil
                        </EzButton>
                      </div>
                    </div>
                  )}

                  <h4 className="text-sm font-semibold text-gray-900 pt-2">Endereços</h4>
                  <ul className="divide-y divide-gray-100 border border-gray-200 rounded-[12px]">
                    {(orgDetail.addresses ?? []).map((addr) => (
                      <li key={addr.id} className="flex justify-between items-start px-3 py-2 text-sm">
                        <div>
                          <div className="text-gray-900">
                            {addr.street || '—'}{addr.complement ? `, ${addr.complement}` : ''}
                          </div>
                          <div className="text-gray-500">
                            {[addr.neighborhood, addr.city, addr.state, addr.zipCode].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <EzButton
                          variant="tertiary"
                          size="x-small"
                          aria-label={`Remover endereço ${addr.street || 'sem logradouro'}`}
                          onClick={() => setPendingConfirm({
                            title: 'Remover endereço?',
                            message: `O endereço ${addr.street || 'sem logradouro'} será removido do cadastro do cliente.`,
                            variant: 'danger',
                            onConfirm: () => removeAddressMutation.mutate(addr.id),
                          })}
                          disabled={removeAddressMutation.isPending}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 size={14} />
                        </EzButton>
                      </li>
                    ))}
                    {(orgDetail.addresses ?? []).length === 0 && (
                      <li className="px-3 py-3 text-sm text-gray-500">Nenhum endereço cadastrado.</li>
                    )}
                  </ul>
                  <form
                    onSubmit={handleAddressSubmit((values) => addAddressMutation.mutate(values))}
                    noValidate
                    className="grid grid-cols-2 gap-3 p-3 bg-gray-90 rounded-[12px] border border-gray-200"
                  >
                    <EzTextInput id="addr-zip" label="CEP" {...registerAddress('zipCode')} />
                    <EzTextInput id="addr-street" label="Logradouro" {...registerAddress('street')} />
                    <EzTextInput id="addr-neighborhood" label="Bairro" {...registerAddress('neighborhood')} />
                    <EzTextInput id="addr-city" label="Cidade" {...registerAddress('city')} />
                    <EzTextInput id="addr-state" label="Estado" {...registerAddress('state')} />
                    <EzTextInput id="addr-complement" label="Complemento" {...registerAddress('complement')} />
                    <div className="col-span-2 flex justify-end">
                      <EzButton type="submit" size="small" disabled={addAddressMutation.isPending}>
                        Adicionar Endereço
                      </EzButton>
                    </div>
                    {addressErrors.street && (
                      <p className="col-span-2 text-xs text-red-600">{addressErrors.street.message}</p>
                    )}
                  </form>

                  <h4 className="text-sm font-semibold text-gray-900 pt-2">Contatos</h4>
                  <ul className="divide-y divide-gray-100 border border-gray-200 rounded-[12px]">
                    {(orgDetail.contacts ?? []).map((contact) => (
                      <li key={contact.id} className="flex justify-between items-start px-3 py-2 text-sm">
                        <div>
                          <div className="text-gray-900">
                            {contact.name}{contact.type ? ` · ${contact.type}` : ''}
                          </div>
                          <div className="text-gray-500">
                            {[contact.email, contact.phone].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <EzButton
                          variant="tertiary"
                          size="x-small"
                          aria-label={`Remover contato ${contact.name}`}
                          onClick={() => setPendingConfirm({
                            title: 'Remover contato?',
                            message: `O contato ${contact.name} será removido do cadastro do cliente.`,
                            variant: 'danger',
                            onConfirm: () => removeContactMutation.mutate(contact.id),
                          })}
                          disabled={removeContactMutation.isPending}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 size={14} />
                        </EzButton>
                      </li>
                    ))}
                    {(orgDetail.contacts ?? []).length === 0 && (
                      <li className="px-3 py-3 text-sm text-gray-500">Nenhum contato cadastrado.</li>
                    )}
                  </ul>
                  <form
                    onSubmit={handleContactSubmit((values) => addContactMutation.mutate(values))}
                    noValidate
                    className="grid grid-cols-2 gap-3 p-3 bg-gray-90 rounded-[12px] border border-gray-200"
                  >
                    <EzTextInput
                      id="contact-name"
                      label="Nome"
                      hasError={!!contactErrors.name}
                      message={contactErrors.name?.message}
                      {...registerContact('name')}
                    />
                    <EzTextInput id="contact-type" label="Tipo de Contato" {...registerContact('type')} />
                    <EzTextInput id="contact-email" label="E-mail" {...registerContact('email')} />
                    <EzTextInput id="contact-phone" label="Telefone" {...registerContact('phone')} />
                    <div className="col-span-2 flex justify-end">
                      <EzButton type="submit" size="small" disabled={addContactMutation.isPending}>
                        Adicionar Contato
                      </EzButton>
                    </div>
                  </form>
                </div>
              )}

              {detailTab === 'users' && (
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-gray-900">Usuários vinculados</h4>
                  {isLoadingUsers ? <EzSpinner label="Carregando usuários…" /> : (
                    <div className="max-h-72 overflow-y-auto space-y-2 border border-gray-200 rounded-[12px] p-3">
                      {(usersList ?? []).filter(u => u.role.includes('CLIENT')).map(u => {
                        const isPinned = u.organizationId === detailOrgId;
                        return (
                          <div key={u.id} className="flex justify-between items-center text-sm p-1 hover:bg-gray-90 rounded-[8px]">
                            <div>
                              <span className="text-gray-900">{u.name}</span>{' '}
                              <span className="text-gray-500">({u.email})</span>
                            </div>
                            <EzButton
                              variant="tertiary"
                              size="x-small"
                              disabled={attachUserMutation.isPending}
                              onClick={() => attachUserMutation.mutate({ userId: u.id, orgId: isPinned ? null : detailOrgId })}
                              className={isPinned ? 'text-red-600 hover:text-red-700' : 'text-green-600 hover:text-green-700'}
                            >
                              {isPinned ? 'Remover' : 'Adicionar'}
                            </EzButton>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {detailTab === 'resources' && (
                <EzEmptyCard
                  title="Nenhum recurso cadastrado"
                  description="O Aponta ainda não possui um módulo de Recursos (ativos/equipamentos) por cliente. Esta aba ainda não tem funcionalidade."
                />
              )}

              {detailTab === 'relationships' && (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">
                      Mesas (Mesa↔Cliente é N:N)
                    </h4>
                    <ul className="divide-y divide-gray-100 border border-gray-200 rounded-[12px]">
                      {(orgDetail.serviceDesks ?? []).map((desk) => (
                        <li key={desk.id} className="flex justify-between items-center px-3 py-2 text-sm">
                          <span className="text-gray-900">{desk.name}</span>
                          <EzButton
                            variant="tertiary"
                            size="x-small"
                            onClick={() => unlinkDeskMutation.mutate(desk.id)}
                            disabled={unlinkDeskMutation.isPending}
                            className="text-red-600 hover:text-red-700"
                          >
                            Desvincular
                          </EzButton>
                        </li>
                      ))}
                      {(orgDetail.serviceDesks ?? []).length === 0 && (
                        <li className="px-3 py-3 text-sm text-gray-500">Nenhuma mesa vinculada.</li>
                      )}
                    </ul>
                    <div className="flex items-end gap-2 mt-2">
                      <div className="flex-1">
                        <EzComboBox
                          id="link-desk"
                          label="Adicionar mesa de serviço"
                          value={linkDeskId}
                          onChange={(e) => setLinkDeskId(e.target.value)}
                        >
                          <option value="">Selecione uma mesa…</option>
                          {availableDesksToLink.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </EzComboBox>
                      </div>
                      <EzButton
                        size="small"
                        disabled={!linkDeskId || linkDeskMutation.isPending}
                        onClick={() => linkDeskId && linkDeskMutation.mutate(linkDeskId)}
                      >
                        Vincular
                      </EzButton>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">
                      Grupos de atendentes do cliente
                    </h4>
                    <ul className="divide-y divide-gray-100 border border-gray-200 rounded-[12px]">
                      {(orgDetail.agentGroups ?? []).map((group) => (
                        <li key={group.id} className="flex justify-between items-start px-3 py-2 text-sm">
                          <div>
                            <div className="text-gray-900 font-medium">{group.name}</div>
                            <div className="text-gray-500">
                              {group.members.map((m) => m.name).join(', ') || 'Sem atendentes'}
                            </div>
                          </div>
                          <EzButton
                            variant="tertiary"
                            size="x-small"
                            aria-label={`Remover grupo de atendentes ${group.name}`}
                            onClick={() => setPendingConfirm({
                              title: 'Remover grupo de atendentes?',
                              message: `O grupo ${group.name} será removido do cadastro do cliente.`,
                              variant: 'danger',
                              onConfirm: () => removeAgentGroupMutation.mutate(group.id),
                            })}
                            disabled={removeAgentGroupMutation.isPending}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 size={14} />
                          </EzButton>
                        </li>
                      ))}
                      {(orgDetail.agentGroups ?? []).length === 0 && (
                        <li className="px-3 py-3 text-sm text-gray-500">Nenhum grupo de atendentes cadastrado.</li>
                      )}
                    </ul>
                    <form
                      onSubmit={handleAgentGroupSubmit((values) => createAgentGroupMutation.mutate(values))}
                      noValidate
                      className="grid grid-cols-1 gap-3 p-3 bg-gray-90 rounded-[12px] border border-gray-200 mt-2"
                    >
                      <EzTextInput
                        id="agent-group-name"
                        label="Nome do grupo"
                        hasError={!!agentGroupErrors.name}
                        message={agentGroupErrors.name?.message}
                        {...registerAgentGroup('name')}
                      />
                      <EzMultiSelect
                        id="agent-group-members"
                        label="Atendentes"
                        value={newGroupMemberIds}
                        onChange={setNewGroupMemberIds}
                        options={userOptions}
                      />
                      <div className="flex justify-end">
                        <EzButton type="submit" size="small" disabled={createAgentGroupMutation.isPending}>
                          Adicionar grupo de atendentes
                        </EzButton>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {detailTab === 'billing' && (
                <div className="space-y-6" data-testid="org-billing-tab-content">
                  <div className="bg-white p-5 rounded-[12px] border border-gray-200 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-5 h-5 text-brand-600" />
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">
                            Preferências de Faturamento & Cobrança
                          </h4>
                          <p className="text-xs text-gray-500">
                            Configurações de regime financeiro, faturamento quarteirizado e canais de cobrança.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-gray-500">Regime atual:</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            (billingDraft?.quarterlyBilling ?? orgDetail.quarterlyBilling)
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {(billingDraft?.quarterlyBilling ?? orgDetail.quarterlyBilling)
                            ? 'Faturamento Quarteirizado'
                            : 'Faturamento Direto'}
                        </span>
                      </div>
                    </div>

                    {/* Faturamento Quarteirizado card */}
                    <div className="p-4 rounded-[8px] bg-gray-50 border border-gray-200 space-y-2">
                      <div className="flex items-center gap-2">
                        <EzCheck
                          id="org-billing-quarterly-checkbox"
                          label="Habilitar faturamento quarteirizado"
                          checked={billingDraft?.quarterlyBilling ?? (orgDetail.quarterlyBilling === true)}
                          disabled={updateOrgMutation.isPending}
                          onChange={(e) =>
                            setBillingDraft((prev) => ({
                              ...prev,
                              quarterlyBilling: e.target.checked,
                            }))
                          }
                        />
                      </div>
                      <p className="text-[12px] text-gray-600 pl-6">
                        Quando ativado, os apontamentos de horas e ordens de serviço deste cliente serão direcionados para o regime de faturamento quarteirizado por organização / parceiro.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <EzTextInput
                          id="org-billing-emails"
                          label="E-mails para Envio de Cobrança / Faturas"
                          placeholder="ex: financeiro@empresa.com.br, faturas@empresa.com.br"
                          value={billingDraft?.billingEmails ?? (orgDetail.billingEmails || '')}
                          onChange={(e) =>
                            setBillingDraft((prev) => ({
                              ...prev,
                              billingEmails: e.target.value,
                            }))
                          }
                        />
                        <span className="text-[11px] text-gray-400 block">
                          E-mails que receberão as notificações e relatórios de faturamento (separados por vírgula).
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <EzTextInput
                            id="org-billing-due-day"
                            label="Dia de Vencimento"
                            type="number"
                            min="1"
                            max="31"
                            placeholder="ex: 10"
                            value={
                              billingDraft?.billingDueDay !== undefined
                                ? String(billingDraft.billingDueDay)
                                : (orgDetail.billingDueDay ? String(orgDetail.billingDueDay) : '')
                            }
                            onChange={(e) =>
                              setBillingDraft((prev) => ({
                                ...prev,
                                billingDueDay: e.target.value ? parseInt(e.target.value, 10) : '',
                              }))
                            }
                          />
                          <span className="text-[11px] text-gray-400 block">
                            Dia do mês (1 a 31).
                          </span>
                        </div>

                        <div className="space-y-1">
                          <EzComboBox
                            id="org-billing-method"
                            label="Forma de Pagamento"
                            value={billingDraft?.billingMethod ?? (orgDetail.billingMethod || 'BOLETO')}
                            onChange={(e) =>
                              setBillingDraft((prev) => ({
                                ...prev,
                                billingMethod: e.target.value,
                              }))
                            }
                          >
                            <option value="BOLETO">Boleto Bancário</option>
                            <option value="PIX">PIX</option>
                            <option value="TRANSFERENCIA">Transferência</option>
                            <option value="CARTAO">Cartão de Crédito</option>
                          </EzComboBox>
                          <span className="text-[11px] text-gray-400 block">
                            Método preferencial.
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <EzTextArea
                        id="org-billing-notes"
                        label="Instruções e Observações de Faturamento"
                        placeholder="Ex: Emissão de nota com ordem de compra específica; chave PIX CNPJ; faturamento consolidado mensal..."
                        rows={3}
                        value={billingDraft?.billingNotes ?? (orgDetail.billingNotes || '')}
                        onChange={(e) =>
                          setBillingDraft((prev) => ({
                            ...prev,
                            billingNotes: e.target.value,
                          }))
                        }
                      />
                    </div>

                    <div className="flex justify-end pt-2 border-t border-gray-100">
                      <EzButton
                        size="small"
                        disabled={updateOrgMutation.isPending}
                        onClick={() => {
                          const payload: Partial<Organization> = {
                            ...(billingDraft?.quarterlyBilling !== undefined
                              ? { quarterlyBilling: billingDraft.quarterlyBilling }
                              : {}),
                            ...(billingDraft?.billingEmails !== undefined
                              ? { billingEmails: billingDraft.billingEmails }
                              : {}),
                            ...(billingDraft?.billingDueDay !== undefined
                              ? {
                                  billingDueDay:
                                    typeof billingDraft.billingDueDay === 'number'
                                      ? billingDraft.billingDueDay
                                      : null,
                                }
                              : {}),
                            ...(billingDraft?.billingMethod !== undefined
                              ? { billingMethod: billingDraft.billingMethod }
                              : {}),
                            ...(billingDraft?.billingNotes !== undefined
                              ? { billingNotes: billingDraft.billingNotes }
                              : {}),
                          };
                          updateOrgMutation.mutate(payload, {
                            onSuccess: () => setBillingDraft(null),
                          });
                        }}
                      >
                        Salvar Preferências de Faturamento
                      </EzButton>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        )}
          </div>
        )}
      </div>

      {isScreenConfigModalOpen && (
        <EzEntityScreenConfigModal
          columns={screenConfigColumns}
          onToggleColumn={(colId) =>
            setColumnVisibility((prev) => ({
              ...prev,
              [colId]: !prev[colId],
            }))
          }
          density={screenConfig.grid.density}
          onDensityChange={setDensity}
          formLayout={screenConfig.form.layout}
          onFormLayoutChange={setFormLayout}
          onRestoreDefaults={restoreDefaults}
          onClose={() => setIsScreenConfigModalOpen(false)}
          initialTab={screenConfigInitialTab}
        />
      )}

      {/* DMTE-559: CNPJ/CPF repetido bloqueia o cadastro e avisa em pop-up */}
      <EzModal
        isOpen={duplicateDocument !== null}
        onClose={() => setDuplicateDocument(null)}
        title={duplicateTitle}
        aria-label={duplicateTitle}
        maxWidth="sm"
        trapFocus
        footer={
          <div className="flex justify-end">
            <EzButton variant="primary" size="small" autoFocus onClick={() => setDuplicateDocument(null)}>
              Entendi
            </EzButton>
          </div>
        }
      >
        <p className="p-1 text-sm text-gray-700">{duplicateDocument} Confira o número digitado ou use o cadastro existente.</p>
      </EzModal>

      {/* Modal: Cadastrar Parceiro por CNPJ (Sankhya / Receita Federal parity) */}
      <EzModal
        isOpen={isCnpjModalOpen}
        onClose={() => {
          setIsCnpjModalOpen(false);
          setCnpjModalError(null);
        }}
        title="Cadastrar Parceiro por CNPJ"
        maxWidth="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <EzButton
              variant="secondary"
              size="small"
              onClick={() => setIsCnpjModalOpen(false)}
            >
              Cancelar
            </EzButton>
            <EzButton
              variant="primary"
              size="small"
              disabled={isLookingUpCnpjModal || !cnpjModalInput.trim()}
              onClick={handleCnpjModalSubmit}
            >
              {isLookingUpCnpjModal ? 'Consultando…' : 'Consultar e Abrir Cadastro'}
            </EzButton>
          </div>
        }
      >
        <div className="space-y-3 p-1">
          <p className="text-xs text-gray-600">
            Informe o CNPJ da empresa. Os dados cadastrais (Razão Social, Nome Fantasia, Endereço) serão consultados automaticamente na Receita Federal para pré-preenchimento do formulário.
          </p>
          <div className="space-y-1">
            <label htmlFor="cnpj-modal-input" className="text-xs font-medium text-gray-700">
              CNPJ
            </label>
            <EzTextInput
              id="cnpj-modal-input"
              placeholder="00.000.000/0000-00"
              value={cnpjModalInput}
              onChange={(e) => setCnpjModalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCnpjModalSubmit();
              }}
              autoFocus
            />
          </div>
          {cnpjModalError && (
            <EzAlert variant="error" onClose={() => setCnpjModalError(null)}>
              {cnpjModalError}
            </EzAlert>
          )}
        </div>
      </EzModal>
      {deleteTargets && (
        <OrganizationDeleteDialog targets={deleteTargets} onClose={() => setDeleteTargets(null)} onDone={handleDeleted} />
      )}
      <EzDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        variant={pendingConfirm?.variant}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const confirmed = pendingConfirm;
          setPendingConfirm(null);
          confirmed?.onConfirm();
        }}
      />
    </EzPageLayout>
  );
}

export default OrganizationsPage;
