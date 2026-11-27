import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../../lib/api';
import type { TicketPriority } from '../../hooks/useTickets';
import { priorityLabels } from './TicketCard';
import type { CatalogItem } from '../../pages/CreateTicketPage';
import { useAuthStore } from '../../stores/authStore';

// DS Components
import {
  EzAlert,
  EzButton,
  EzTextInput,
  EzSearch,
  EzComboBox,
  EzRichText,
  EzUpload,
  EzDateInput,
  EzMultiSelect,
  EzFileItem
} from '../ds';
import { useEffect, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';

interface ServiceDesk {
  id: string;
  name: string;
  displayName?: string | null;
  active?: boolean;
  acceptingNewTickets?: boolean;
  internalUse?: boolean;
  organizations?: { id: string }[];
  requireAttachments?: boolean;
  priorities?: { ticketPriority: TicketPriority; enabled: boolean; label?: string }[];
}
interface Organization { id: string; name: string; active?: boolean }
interface UserData { id: string; name: string; organizationId?: string }

const priorities = Object.keys(priorityLabels) as TicketPriority[];

export const ticketFormSchema = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório'),
  description: z.string().trim().min(1, 'Descrição é obrigatória'),
  // NOTE: Issue #49 documents that Cliente/Solicitante are still backend
  // gaps — there's no ServiceDesk<->Organization link and no seeded
  // Organization data yet. Keeping these required here would make it
  // IMPOSSIBLE to create any ticket at all (the DTO doesn't even accept
  // these fields — see CreateTicketPage's mutationFn). They stay as
  // optional UI affordances until that backend work lands.
  organizationId: z.string().optional(),
  serviceDeskId: z.string().min(1, 'Mesa é obrigatória'),
  requesterId: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  parentId: z.string().optional(),
  followersIds: z.array(z.string()).optional(),
  scheduledDate: z.string().optional(),
  attachments: z.array(z.custom<File>()).optional(),
});

export type TicketFormValues = z.infer<typeof ticketFormSchema>;

interface TicketFormProps {
  onSubmit: (values: TicketFormValues & { saveAndNew?: boolean }) => void;
  isSubmitting?: boolean;
  submitError?: string | null;
  catalogOverride?: CatalogItem | null;
  /** Cliente escolhido no catálogo: chega preenchido e travado. */
  lockedOrganizationId?: string;
  /** Avisa a página quando o formulário passa a ter (ou deixa de ter) alterações não enviadas. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface ParentTicketRow { id: string; protocol?: string; title: string }

const PARENT_SEARCH_DEBOUNCE_MS = 300;
const PARENT_SEARCH_LIMIT = '20';

export function TicketForm({ onSubmit, isSubmitting, submitError, catalogOverride, lockedOrganizationId, onDirtyChange }: TicketFormProps) {
  const currentUser = useAuthStore((state) => state.user);

  // Queries (Mocking relations missing in Prisma for UI completion)
  const { data: orgs = [] } = useQuery({
    queryKey: ['organizations', { active: true }],
    queryFn: async () => {
      // Tiflux-parity: clientes inativos não devem aparecer como opção ao abrir tickets (issue #56).
      const { data } = await api.get<Organization[]>('/organizations', { params: { active: true } });
      return data;
    },
  });

  const { data: serviceDesks = [] } = useQuery({
    queryKey: ['service-desks'],
    queryFn: async () => {
      const { data } = await api.get<ServiceDesk[]>('/service-desks');
      return data;
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      // Endpoint to ideally list all users
      const { data } = await api.get<UserData[]>('/users').catch(() => ({ data: [] }));
      return data.length ? data : currentUser ? [{ id: currentUser.sub, name: currentUser.email }] : [];
    },
  });

  // Ticket Pai: busca remota por protocolo/título (GET /tickets?search=), em vez de carregar só a
  // 1ª página da fila. O escopo de tenant/mesa continua no backend.
  const [parentSearch, setParentSearch] = useState('');
  const [debouncedParentSearch, setDebouncedParentSearch] = useState('');
  const [selectedParent, setSelectedParent] = useState<{ label: string; value: string } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedParentSearch(parentSearch.trim()), PARENT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [parentSearch]);

  const { data: tickets = [] } = useQuery({
    queryKey: ['tickets-parent-options', debouncedParentSearch],
    queryFn: async () => {
      const { data } = await api
        .get<{ data: ParentTicketRow[] } | ParentTicketRow[]>('/tickets', {
          params: { limit: PARENT_SEARCH_LIMIT, ...(debouncedParentSearch ? { search: debouncedParentSearch } : {}) },
        })
        .catch(() => ({ data: [] as ParentTicketRow[] }));
      const rows = Array.isArray(data) ? data : data?.data ?? [];
      return rows.map((t) => ({ id: t.id, protocol: t.protocol, title: t.title }));
    },
    placeholderData: keepPreviousData,
  });

  const isClientBase = currentUser?.role === 'CLIENT' || currentUser?.role === 'CLIENT_MASTER';

  const { register, handleSubmit, control, watch, formState: { errors, isDirty } } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: {
      title: catalogOverride?.title || '',
      description: '',
      organizationId: isClientBase ? currentUser?.organizationId || '' : lockedOrganizationId ?? '',
      serviceDeskId: catalogOverride?.defaultServiceDeskId || '',
      requesterId: currentUser?.role === 'CLIENT' ? currentUser?.sub || '' : '',
      priority: catalogOverride?.defaultPriority || 'MEDIUM',
      followersIds: [],
    },
  });

  const watchOrgId = watch('organizationId');
  const watchDeskId = watch('serviceDeskId');
  const [showSchedule, setShowSchedule] = useState(false);
  const [attachmentsRequiredError, setAttachmentsRequiredError] = useState(false);
  const uploadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const availableDesks = serviceDesks.filter((desk) => {
    if (desk.active === false || desk.acceptingNewTickets === false) return false;
    if (isClientBase && desk.internalUse === true) return false;
    // Mesmo critério de deskServesOrganization na API: mesa sem Cliente vinculado é global.
    if (!isClientBase && watchOrgId && desk.organizations?.length && !desk.organizations.some((org) => org.id === watchOrgId)) return false;
    return true;
  });
  const selectedDesk = availableDesks.find((desk) => desk.id === watchDeskId);
  const availablePriorities = selectedDesk?.priorities?.length
    ? selectedDesk.priorities.filter((priority) => priority.enabled)
    : priorities.map((p) => ({ ticketPriority: p, enabled: true, label: priorityLabels[p] })); 

  const showAttachmentsError =
    attachmentsRequiredError && !!selectedDesk?.requireAttachments && !(watch('attachments')?.length);

  const availableRequesters = users.filter(u => {
    if (currentUser?.role === 'CLIENT') return u.id === currentUser?.sub;
    if (watchOrgId) return u.organizationId === watchOrgId || u.id === currentUser?.sub;
    return true;
  });

  const orgOptions = orgs.map(o => ({ label: o.name, value: o.id }));
  const requesterOptions = availableRequesters.map(u => ({ label: u.name, value: u.id }));
  const fetchedParentOptions = tickets.map((t) => ({
    label: t.protocol ? `#${t.protocol} - ${t.title}` : t.title,
    value: t.id,
  }));
  // O pai escolhido continua nas opções mesmo que a busca seguinte não o devolva.
  const ticketOptions =
    selectedParent && !fetchedParentOptions.some((option) => option.value === selectedParent.value)
      ? [selectedParent, ...fetchedParentOptions]
      : fetchedParentOptions;
  const followerOptions = users.map(u => ({ label: u.name, value: u.id }));

  // Mesa que exige anexo: sem arquivo não envia; o erro fica junto do upload e o foco vai para ele.
  const submitValues = (data: TicketFormValues, saveAndNew?: boolean) => {
    if (selectedDesk?.requireAttachments && !data.attachments?.length) {
      setAttachmentsRequiredError(true);
      uploadRef.current?.focus();
      return;
    }
    onSubmit(saveAndNew ? { ...data, saveAndNew: true } : data);
  };

  return (
    <form
      onSubmit={handleSubmit((data) => submitValues(data))}
      noValidate
      className="w-full space-y-6 bg-white p-6 md:p-8 rounded-card border border-gray-100 shadow-card"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 pb-6 border-b border-gray-100">
        <Controller
          name="organizationId"
          control={control}
          render={({ field }) => (
            <EzSearch
              id="ticket-organization"
              label="Cliente"
              placeholder="Buscar cliente..."
              options={orgOptions}
              value={field.value}
              onChange={field.onChange}
              hasError={!!errors.organizationId}
              message={errors.organizationId?.message}
              disabled={currentUser?.role === 'CLIENT' || !!lockedOrganizationId}
            />
          )}
        />

        <Controller
          name="serviceDeskId"
          control={control}
          render={({ field }) => (
            <EzComboBox
              id="ticket-service-desk"
              label="Mesa"
              value={field.value}
              onChange={field.onChange}
              hasError={!!errors.serviceDeskId}
              message={errors.serviceDeskId?.message}
              required
              disabled={!!catalogOverride}
            >
              <option value="">Selecione uma mesa</option>
              {availableDesks.map(d => <option key={d.id} value={d.id}>{d.displayName || d.name}</option>)}
            </EzComboBox>
          )}
        />
        <Controller
          name="requesterId"
          control={control}
          render={({ field }) => (
            <EzSearch
              id="ticket-requester"
              label="Solicitante"
              placeholder="Buscar usuário..."
              options={requesterOptions}
              value={field.value}
              onChange={field.onChange}
              hasError={!!errors.requesterId}
              message={errors.requesterId?.message}
              disabled={currentUser?.role === 'CLIENT'}
            />
          )}
        />

        <Controller
          name="priority"
          control={control}
          render={({ field }) => (
            <EzComboBox
              id="ticket-priority"
              label="Prioridade"
              value={field.value}
              onChange={field.onChange}
              hasError={!!errors.priority}
              message={errors.priority?.message}
              disabled={!!catalogOverride}
            >
              {availablePriorities.map((p) => (
                <option key={p.ticketPriority} value={p.ticketPriority}>
                  {p.label ?? priorityLabels[p.ticketPriority]}
                </option>
              ))}
            </EzComboBox>
          )}
        />
      </div>

      <div className="space-y-6 pb-6 border-b border-gray-100">
        <EzTextInput
          id="ticket-title"
          label="Título (Assunto)"
          {...register('title')}
          hasError={!!errors.title}
          message={errors.title?.message}
          readOnly={!!catalogOverride}
          disabled={!!catalogOverride}
          required
        />

        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <EzRichText
              testId="ticket-description"
              label="Descrição Detalhada"
              value={field.value}
              onChange={field.onChange}
              hasError={!!errors.description}
              message={errors.description?.message}
            />
          )}
        />

        <Controller
          name="attachments"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              <EzUpload
                ref={uploadRef}
                tabIndex={-1}
                data-testid="ticket-attachments"
                aria-describedby={showAttachmentsError ? 'ticket-attachments-error' : undefined}
                hasError={showAttachmentsError}
                label={selectedDesk?.requireAttachments ? 'Anexos (obrigatório nesta mesa)' : 'Anexar arquivos (Imagens, PDF, Docs)'}
                accept="image/*,.pdf,.doc,.docx"
                multiple
                onChange={(files) => field.onChange([...(field.value || []), ...files])}
              />
              {showAttachmentsError && (
                <p id="ticket-attachments-error" role="alert" className="text-[12px] font-medium text-red-700">
                  Anexe ao menos um arquivo: esta mesa exige anexo.
                </p>
              )}
              {field.value && field.value.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  {field.value.map((f, i) => (
                    <EzFileItem 
                      key={i} 
                      file={f} 
                      onRemove={() => {
                        const newFiles = [...field.value!];
                        newFiles.splice(i, 1);
                        field.onChange(newFiles);
                      }} 
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-gray-100">
        <Controller
          name="parentId"
          control={control}
          render={({ field }) => (
            <EzSearch
              id="ticket-parent"
              label="Ticket Pai (Opcional)"
              placeholder="Buscar ticket existente..."
              options={ticketOptions}
              value={field.value}
              onSearchChange={setParentSearch}
              onChange={(value) => {
                field.onChange(value == null ? undefined : String(value));
                setSelectedParent(ticketOptions.find((option) => String(option.value) === String(value)) ?? null);
              }}
            />
          )}
        />

        <Controller
          name="followersIds"
          control={control}
          render={({ field }) => (
            <EzMultiSelect
              label="Seguidores"
              placeholder="Adicionar seguidores..."
              options={followerOptions}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      {showSchedule && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-300 pb-4">
          <Controller
            name="scheduledDate"
            control={control}
            render={({ field }) => (
              <EzDateInput
                label="Data para Agendamento"
                className="max-w-[200px]"
                {...field}
              />
            )}
          />
        </div>
      )}

      {submitError && (
        <EzAlert variant="error">{submitError}</EzAlert>
      )}

      {/* Anuncia o envio a leitores de tela; só existe enquanto envia, para não repetir o role=status de outros avisos da tela. */}
      {isSubmitting && (
        <p role="status" className="sr-only">
          Criando chamado…
        </p>
      )}

      <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-between gap-4 pt-2">
        <div>
          <EzButton
            type="button"
            variant="tertiary"
            leftIcon={CalendarClock}
            onClick={() => setShowSchedule(!showSchedule)}
            label={showSchedule ? "Cancelar Agendamento" : "Agendar Ticket"}
          />
        </div>
        
        <div className="flex sm:flex-wrap items-center justify-end gap-3 w-full sm:w-auto sm:ml-auto">
          <EzButton
            type="button"
            variant="secondary"
            onClick={handleSubmit((data) => submitValues(data, true))}
            disabled={isSubmitting}
            label="Salvar e criar novo"
            className="w-full sm:w-auto"
          />
          <EzButton
            type="submit"
            variant="primary"
            disabled={isSubmitting}
            label={isSubmitting ? "Enviando..." : "Abrir Ticket"}
            className="w-full sm:w-auto"
          />
        </div>
      </div>
    </form>
  );
}

export default TicketForm;
