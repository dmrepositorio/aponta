import { HTMLAttributes, KeyboardEvent, ReactNode, forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface EzTreeNode {
  id: string | number;
  label: string;
  children?: EzTreeNode[];
  icon?: ReactNode;
}

export interface EzTreeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  /**
   * The root nodes of the tree. Each node may have nested `children`.
   */
  nodes: EzTreeNode[];
  /**
   * Called with the node activated by click, Enter or Space.
   */
  onSelect?: (node: EzTreeNode) => void;
  /**
   * Id of the currently selected node, to highlight it.
   */
  selectedId?: string | number;
  /**
   * Ids of nodes expanded by default.
   */
  defaultExpandedIds?: (string | number)[];
}

type NodeId = string | number;

interface FlatItem {
  node: EzTreeNode;
  parentId: NodeId | null;
}

function flatten(nodes: EzTreeNode[], expanded: Set<NodeId>, parentId: NodeId | null = null): FlatItem[] {
  return nodes.flatMap((node) => [
    { node, parentId },
    ...(node.children?.length && expanded.has(node.id) ? flatten(node.children, expanded, node.id) : []),
  ]);
}

interface EzTreeNodeItemProps {
  node: EzTreeNode;
  level: number;
  posInSet: number;
  setSize: number;
  focusedId: NodeId | undefined;
  onItemKeyDown: (e: KeyboardEvent<HTMLDivElement>, node: EzTreeNode) => void;
  onItemFocus: (id: NodeId) => void;
  registerItem: (id: NodeId, el: HTMLDivElement | null) => void;
  selectedId?: NodeId;
  onSelect?: (node: EzTreeNode) => void;
  expanded: Set<NodeId>;
  toggleExpand: (id: NodeId) => void;
}

function EzTreeNodeItem({
  node,
  level,
  posInSet,
  setSize,
  focusedId,
  onItemKeyDown,
  onItemFocus,
  registerItem,
  selectedId,
  onSelect,
  expanded,
  toggleExpand,
}: EzTreeNodeItemProps) {
  const hasChildren = !!node.children && node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        ref={(el) => registerItem(node.id, el)}
        role="treeitem"
        tabIndex={focusedId === node.id ? 0 : -1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-level={level + 1}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        data-testid={`tree-node-${node.id}`}
        onClick={() => {
          onItemFocus(node.id);
          onSelect?.(node);
        }}
        onFocus={(e) => {
          if (e.target === e.currentTarget) onItemFocus(node.id);
        }}
        onKeyDown={(e) => onItemKeyDown(e, node)}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        className={cn(
          'flex items-center gap-1 py-1.5 pr-2 rounded-[8px] cursor-pointer text-[14px] transition-colors select-none ez-focus-inset',
          isSelected ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-900 hover:bg-gray-90'
        )}
      >
        <button
          type="button"
          aria-label={isOpen ? 'Recolher' : 'Expandir'}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpand(node.id);
          }}
          className={cn(
            'flex items-center justify-center w-4 h-4 shrink-0',
            !hasChildren && 'opacity-0 pointer-events-none'
          )}
        >
          {hasChildren &&
            (isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}
        </button>
        {node.icon && (
          <span className="flex items-center justify-center w-4 h-4 shrink-0">{node.icon}</span>
        )}
        <span className="truncate">{node.label}</span>
      </div>

      {hasChildren && isOpen && (
        <div role="group">
          {node.children!.map((child, index) => (
            <EzTreeNodeItem
              key={child.id}
              node={child}
              level={level + 1}
              posInSet={index + 1}
              setSize={node.children!.length}
              focusedId={focusedId}
              onItemKeyDown={onItemKeyDown}
              onItemFocus={onItemFocus}
              registerItem={registerItem}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Aponta DS Tree (inspired by @sankhyalabs/ezui)
 * Expandable hierarchical tree with per-level indentation.
 * Teclado (WAI-ARIA APG TreeView): roving tabindex, Cima/Baixo, Direita/Esquerda
 * (expande/recolhe e entra/sai do grupo), Home/End; Enter e Espaço selecionam.
 */
export const EzTree = forwardRef<HTMLDivElement, EzTreeProps>(
  ({ nodes, onSelect, selectedId, defaultExpandedIds = [], className, ...props }, ref) => {
    const [expanded, setExpanded] = useState<Set<NodeId>>(new Set(defaultExpandedIds));
    const [focusId, setFocusId] = useState<NodeId | undefined>(undefined);
    const itemRefs = useRef(new Map<NodeId, HTMLDivElement>());
    const pendingFocus = useRef<NodeId | null>(null);

    const toggleExpand = (id: NodeId) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    const items = useMemo(() => flatten(nodes, expanded), [nodes, expanded]);

    // Roving tabindex: um único item tabulável (o último focado, senão o selecionado, senão o primeiro).
    const visibleIds = items.map((i) => i.node.id);
    const focusedId: NodeId | undefined =
      focusId !== undefined && visibleIds.includes(focusId)
        ? focusId
        : selectedId !== undefined && visibleIds.includes(selectedId)
          ? selectedId
          : visibleIds[0];

    useEffect(() => {
      if (pendingFocus.current === null) return;
      itemRefs.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    });

    const registerItem = (id: NodeId, el: HTMLDivElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    };

    const moveFocus = (id: NodeId | undefined) => {
      if (id === undefined) return;
      pendingFocus.current = id;
      setFocusId(id);
    };

    const onItemKeyDown = (e: KeyboardEvent<HTMLDivElement>, node: EzTreeNode) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const index = items.findIndex((i) => i.node.id === node.id);
      const hasChildren = !!node.children && node.children.length > 0;
      const isOpen = expanded.has(node.id);
      let handled = true;
      switch (e.key) {
        case 'ArrowDown':
          moveFocus(items[index + 1]?.node.id);
          break;
        case 'ArrowUp':
          moveFocus(items[index - 1]?.node.id);
          break;
        case 'Home':
          moveFocus(items[0]?.node.id);
          break;
        case 'End':
          moveFocus(items[items.length - 1]?.node.id);
          break;
        case 'ArrowRight':
          if (hasChildren && !isOpen) toggleExpand(node.id);
          else if (hasChildren) moveFocus(node.children![0].id);
          break;
        case 'ArrowLeft':
          if (hasChildren && isOpen) toggleExpand(node.id);
          else if (items[index]?.parentId != null) moveFocus(items[index].parentId!);
          break;
        case 'Enter':
        case ' ':
          onSelect?.(node);
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    return (
      <div ref={ref} role="tree" className={cn('flex flex-col w-full gap-0.5', className)} {...props}>
        {nodes.map((node, index) => (
          <EzTreeNodeItem
            key={node.id}
            node={node}
            level={0}
            posInSet={index + 1}
            setSize={nodes.length}
            focusedId={focusedId}
            onItemKeyDown={onItemKeyDown}
            onItemFocus={setFocusId}
            registerItem={registerItem}
            selectedId={selectedId}
            onSelect={onSelect}
            expanded={expanded}
            toggleExpand={toggleExpand}
          />
        ))}
      </div>
    );
  }
);

EzTree.displayName = 'EzTree';
