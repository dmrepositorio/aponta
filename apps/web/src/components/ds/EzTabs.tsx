import { HTMLAttributes, KeyboardEvent, forwardRef } from 'react';
import { cn } from './utils';

export interface EzTabItem {
  id: string | number;
  label: string;
  disabled?: boolean;
}

export interface EzTabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  tabs: EzTabItem[];
  activeTab: string | number;
  onChange: (tabId: string | number) => void;
  /**
   * The variant style.
   * @default 'line'
   */
  variant?: 'line' | 'pills';
  /**
   * Prefix for the tab and tabpanel ids. With it every tab gets an `id` and
   * `aria-controls`; the consumer builds the panel with `ezTabPanelId`.
   */
  idPrefix?: string;
}

/** Id of a tab button; the panel's `aria-labelledby` points at it. */
export const ezTabId = (prefix: string, tabId: string | number): string => `${prefix}-tab-${tabId}`;

/** Id of a tab's panel; the tab's `aria-controls` points at it. */
export const ezTabPanelId = (prefix: string, tabId: string | number): string => `${prefix}-panel-${tabId}`;

/**
 * Aponta DS Tabs (Tabselector)
 */
export const EzTabs = forwardRef<HTMLDivElement, EzTabsProps>(
  ({ tabs, activeTab, onChange, variant = 'line', idPrefix, className, role, onKeyDown, ...props }, ref) => {
    const resolvedRole = role ?? 'tablist';
    const tabRole = resolvedRole === 'tablist' ? 'tab' : undefined;
    // Tabindex móvel: só a aba ativa (ou a primeira habilitada) entra na ordem do Tab.
    const enabledTabs = tabs.filter((tab) => !tab.disabled);
    const entryId = (enabledTabs.find((tab) => tab.id === activeTab) ?? enabledTabs[0])?.id;

    // Setas, Home e End movem o foco e ativam a aba (ativação automática, padrão ARIA de abas).
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      // Alt+Seta é voltar/avançar do navegador; Ctrl/Meta+tecla também são atalhos dele.
      if (!tabRole || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
      const current = buttons.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      const last = buttons.length - 1;
      const next = { ArrowRight: current === last ? 0 : current + 1, ArrowLeft: current === 0 ? last : current - 1, Home: 0, End: last }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      buttons[next].focus();
      if (enabledTabs[next].id !== activeTab) onChange(enabledTabs[next].id);
    };
    return (
      <div
        ref={ref}
        role={resolvedRole}
        className={cn(
          'flex items-center overflow-x-auto no-scrollbar',
          variant === 'line' ? 'border-b border-gray-200' : 'gap-2',
          className
        )}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const tabAriaProps = tabRole
            ? {
                role: tabRole,
                'aria-selected': isActive,
                tabIndex: tab.id === entryId ? 0 : -1,
                ...(idPrefix && { id: ezTabId(idPrefix, tab.id), 'aria-controls': ezTabPanelId(idPrefix, tab.id) }),
              }
            : {};

          if (variant === 'pills') {
            return (
              <button
                key={tab.id}
                type="button"
                disabled={tab.disabled}
                onClick={() => !tab.disabled && onChange(tab.id)}
                {...tabAriaProps}
                className={cn(
                  'px-4 py-2 rounded-full text-[14px] font-medium transition-colors whitespace-nowrap ez-focus-inset',
                  isActive
                    ? 'bg-brand-100 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-90',
                  tab.disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent'
                )}
              >
                {tab.label}
              </button>
            );
          }

          // Line variant
          return (
            <button
              key={tab.id}
              type="button"
              disabled={tab.disabled}
              onClick={() => !tab.disabled && onChange(tab.id)}
              {...tabAriaProps}
              className={cn(
                'relative px-4 py-3 text-[14px] font-medium transition-colors whitespace-nowrap ez-focus-inset',
                isActive
                  ? 'text-brand-600'
                  : 'text-gray-500 hover:text-gray-900',
                tab.disabled && 'opacity-50 cursor-not-allowed hover:text-gray-500'
              )}
            >
              {tab.label}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-t-sm" />
              )}
            </button>
          );
        })}
      </div>
    );
  }
);

EzTabs.displayName = 'EzTabs';
