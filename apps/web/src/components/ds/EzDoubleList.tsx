import { HTMLAttributes, forwardRef, ReactNode, useState } from 'react';
import { cn } from './utils';
import { EzList, EzListItem } from './EzList';
import { EzButton } from './EzButton';
import { EzTextInput } from './EzTextInput';
import { ChevronRight, ChevronLeft, Search } from 'lucide-react';

export interface EzDoubleListItem {
  id: string | number;
  label: ReactNode;
  description?: ReactNode;
  /** Texto usado no nome acessível dos botões e na busca quando `label` não é texto. */
  accessibleLabel?: string;
}

function textOf(node: ReactNode): string {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

function itemName(item: EzDoubleListItem): string {
  return item.accessibleLabel ?? textOf(item.label);
}

function matches(item: EzDoubleListItem, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return `${itemName(item)} ${textOf(item.description)}`.toLocaleLowerCase().includes(q);
}

export interface EzDoubleListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  available: EzDoubleListItem[];
  selected: EzDoubleListItem[];
  onAdd: (item: EzDoubleListItem) => void;
  onRemove: (item: EzDoubleListItem) => void;
  availableLabel?: string;
  selectedLabel?: string;
  /** Mostra uma busca em cada lista. @default true */
  searchable?: boolean;
  /** Altura máxima (CSS) de cada lista antes de rolar. @default '15rem' */
  listMaxHeight?: string;
  /** Busca remota da lista disponível: recebe o texto digitado (quem usa faz o debounce) e `available` deixa de ser filtrada aqui. */
  onAvailableSearch?: (query: string) => void;
  /** Só com `onAvailableSearch`: troca a lista disponível por carregando ou erro. */
  availableStatus?: 'loading' | 'error';
}

export const EzDoubleList = forwardRef<HTMLDivElement, EzDoubleListProps>(
  (
    {
      available,
      selected,
      onAdd,
      onRemove,
      availableLabel = 'Disponíveis',
      selectedLabel = 'Selecionados',
      searchable = true,
      listMaxHeight = '15rem',
      onAvailableSearch: _onAvailableSearch,
      availableStatus: _availableStatus,
      className,
      ...props
    },
    ref
  ) => {
    const [availableQuery, setAvailableQuery] = useState('');
    const [selectedQuery, setSelectedQuery] = useState('');
    const shownAvailable = available.filter((i) => matches(i, availableQuery));
    const shownSelected = selected.filter((i) => matches(i, selectedQuery));

    const searchBox = (name: string, value: string, onChange: (v: string) => void) =>
      searchable ? (
        <div className="px-2 pt-2">
          <EzTextInput
            type="search"
            size="slim"
            aria-label={`Buscar em ${name}`}
            placeholder="Buscar"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            leftIcon={<Search className="w-4 h-4" aria-hidden="true" />}
          />
        </div>
      ) : null;

    return (
      <div ref={ref} className={cn('flex flex-col sm:flex-row w-full gap-4 items-stretch', className)} {...props}>
        {/* Available List */}
        <div className="flex flex-col flex-1 border border-gray-200 rounded-[12px] bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-90 text-[14px] font-semibold text-gray-900">
            {availableLabel} <span className="text-gray-500 font-normal ml-1">({available.length})</span>
          </div>
          {searchBox(availableLabel, availableQuery, setAvailableQuery)}
          <div
            data-testid="ez-double-list-scroll"
            className="flex-1 overflow-y-auto p-2"
            style={{ maxHeight: listMaxHeight }}
          >
            {available.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Nenhum item disponível</div>
            ) : shownAvailable.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Nenhum resultado para a busca</div>
            ) : (
              <EzList flush>
                {shownAvailable.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 mb-1">
                    <div className="flex-1">
                      <EzListItem
                        description={item.description}
                        className="rounded-[8px] py-2 border border-gray-100 mb-0"
                      >
                        {item.label}
                      </EzListItem>
                    </div>
                    <EzButton
                      variant="secondary"
                      size="small"
                      onClick={() => onAdd(item)}
                      title="Adicionar"
                      aria-label={`Adicionar ${itemName(item)}`.trim()}
                      className="shrink-0 rounded-full w-8 h-8 p-0"
                    >
                      <ChevronRight className="w-4 h-4 hidden sm:block" />
                      <ChevronRight className="w-4 h-4 sm:hidden rotate-90" />
                    </EzButton>
                  </div>
                ))}
              </EzList>
            )}
          </div>
        </div>

        {/* Selected List */}
        <div className="flex flex-col flex-1 border border-brand-200 rounded-[12px] bg-white overflow-hidden ring-1 ring-brand-100">
          <div className="px-4 py-3 border-b border-brand-100 bg-brand-50 text-[14px] font-semibold text-brand-900">
            {selectedLabel} <span className="text-brand-600 font-normal ml-1">({selected.length})</span>
          </div>
          {searchBox(selectedLabel, selectedQuery, setSelectedQuery)}
          <div
            data-testid="ez-double-list-scroll"
            className="flex-1 overflow-y-auto p-2"
            style={{ maxHeight: listMaxHeight }}
          >
            {selected.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Nenhum item selecionado</div>
            ) : shownSelected.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Nenhum resultado para a busca</div>
            ) : (
              <EzList flush>
                {shownSelected.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 mb-1">
                    <EzButton
                      variant="secondary"
                      size="small"
                      onClick={() => onRemove(item)}
                      title="Remover"
                      aria-label={`Remover ${itemName(item)}`.trim()}
                      className="shrink-0 rounded-full w-8 h-8 p-0 border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
                    >
                      <ChevronLeft className="w-4 h-4 hidden sm:block" />
                      <ChevronLeft className="w-4 h-4 sm:hidden -rotate-90" />
                    </EzButton>
                    <div className="flex-1">
                      <EzListItem
                        description={item.description}
                        className="rounded-[8px] py-2 border border-brand-100 bg-brand-50/30 mb-0"
                      >
                        {item.label}
                      </EzListItem>
                    </div>
                  </div>
                ))}
              </EzList>
            )}
          </div>
        </div>
      </div>
    );
  }
);
EzDoubleList.displayName = 'EzDoubleList';