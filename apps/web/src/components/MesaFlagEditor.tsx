import { EzButton, EzCheck } from './ds';
import { useDeskDraft } from './mesaSave';

interface FlagDef {
  key: string;
  label: string;
  /** Tema da flag: flags seguidas com o mesmo tema formam um grupo com título. */
  group?: string;
}

export function MesaFlagEditor({
  deskId,
  flags,
  values,
  buildPayload,
}: {
  deskId: string;
  flags: FlagDef[];
  values: object;
  /** Monta o corpo do PATCH a partir do rascunho; sem ele o corpo é o próprio rascunho. */
  buildPayload?: (draft: Record<string, boolean>) => object;
}) {
  const flagValues = values as Record<string, unknown>;
  const { draft, setDraft, save, isPending } = useDeskDraft<Record<string, boolean>>(
    deskId,
    () => Object.fromEntries(flags.map((f) => [f.key, flagValues[f.key] !== false])),
    buildPayload,
  );

  const sections = flags.reduce<{ title?: string; flags: FlagDef[] }[]>((acc, flag) => {
    const last = acc[acc.length - 1];
    if (last && last.title === flag.group) last.flags.push(flag);
    else acc.push({ title: flag.group, flags: [flag] });
    return acc;
  }, []);

  const renderGrid = (list: FlagDef[]) => (
    <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {list.map((flag) => (
        <EzCheck
          key={flag.key}
          id={`mesa-flag-${flag.key}`}
          label={flag.label}
          checked={draft[flag.key] === true}
          onChange={() => setDraft((prev) => ({ ...prev, [flag.key]: !prev[flag.key] }))}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, index) =>
        section.title ? (
          <fieldset key={`${section.title}-${index}`} className="flex flex-col gap-3">
            <legend className="mb-3 text-sm font-semibold text-gray-900">{section.title}</legend>
            {renderGrid(section.flags)}
          </fieldset>
        ) : (
          <div key={index}>{renderGrid(section.flags)}</div>
        ),
      )}
      <div className="flex justify-end">
        <EzButton type="button" size="small" disabled={isPending} onClick={save}>
          {isPending ? 'Salvando…' : 'Salvar'}
        </EzButton>
      </div>
    </div>
  );
}
