import { EzButton, EzComboBox, EzTextInput } from './ds';
import { useDeskDraft } from './mesaSave';

/** Dados básicos da mesa: nome de exibição e descrição, com um só Salvar. */
export function MesaBasicsForm({
  desk,
}: {
  desk: {
    id: string;
    displayName?: string | null;
    description?: string | null;
  };
}) {
  const { draft, setDraft, save, isPending } = useDeskDraft(desk.id, () => ({
    displayName: desk.displayName ?? '',
    description: desk.description ?? '',
  }));
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <EzTextInput
          id="mesa-display-name"
          name="displayName"
          label="Nome de exibição"
          value={draft.displayName}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, displayName: event.target.value }))
          }
        />
        <EzTextInput
          id="mesa-description"
          name="description"
          label="Descrição"
          value={draft.description}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, description: event.target.value }))
          }
        />
      </div>
      <div className="flex justify-end">
        <EzButton type="submit" size="small" disabled={isPending}>
          Salvar dados básicos
        </EzButton>
      </div>
    </form>
  );
}

/** Status padrão ao abrir e ao fechar um ticket da mesa. */
export function MesaStatusForm({
  desk,
}: {
  desk: {
    id: string;
    defaultOpenStatus?: string;
    defaultClosedStatus?: string;
  };
}) {
  const { draft, setDraft, save, isPending } = useDeskDraft(desk.id, () => ({
    defaultOpenStatus: desk.defaultOpenStatus ?? 'OPEN',
    defaultClosedStatus: desk.defaultClosedStatus ?? 'CLOSED',
  }));
  return (
    <form
      className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <EzComboBox
        id="mesa-default-open-status"
        name="defaultOpenStatus"
        label="Status ao abrir"
        value={draft.defaultOpenStatus}
        onChange={(event) =>
          setDraft((prev) => ({
            ...prev,
            defaultOpenStatus: event.target.value,
          }))
        }
      >
        <option value="OPEN">Aberto</option>
        <option value="IN_PROGRESS">Em andamento</option>
      </EzComboBox>
      <EzComboBox
        id="mesa-default-closed-status"
        name="defaultClosedStatus"
        label="Status ao fechar"
        value={draft.defaultClosedStatus}
        onChange={(event) =>
          setDraft((prev) => ({
            ...prev,
            defaultClosedStatus: event.target.value,
          }))
        }
      >
        <option value="CLOSED">Fechado</option>
        <option value="RESOLVED">Resolvido</option>
      </EzComboBox>
      <div className="flex justify-end sm:col-span-2">
        <EzButton type="submit" size="small" disabled={isPending}>
          Salvar status
        </EzButton>
      </div>
    </form>
  );
}
