/**
 * The scrolling class tree (PROJECTS + LIBRARIES). Owns the expanded set (persisted per
 * workspace in sessionStorage), keyboard focus, drag ghost and scroll-into-view of the active
 * class. Rows are memoised so a store change only re-renders the rows it affects.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { ClassRegistry, ClassTreeNode } from '@impact/core';
import { useStore } from '../../store';
import { TreeRow } from './TreeRow';
import { useSessionSet } from './hooks';
import { ancestorsOf, errorStateOf, flattenTree } from './treeModel';
import type { ErrorMarkers, SectionId, TreeRow as TreeRowModel, TreeSection } from './treeModel';

export interface TreeFilter {
  query: string;
  visible: Set<string>;
  matchCount: number;
  truncated: boolean;
}

export interface ClassTreeProps {
  workspaceId?: string;
  registry: ClassRegistry;
  registryVersion: number;
  sections: TreeSection[];
  filter?: TreeFilter;
  markers: ErrorMarkers;
  childrenOf: (name: string) => ClassTreeNode[];
  onContextMenu(e: MouseEvent, node: ClassTreeNode, isProjectRoot: boolean): void;
  /** Extra controls rendered at the right of a section header (e.g. the Configure workspace cog). */
  headerActions?: Partial<Record<SectionId, ReactNode>>;
}

type NodeRow = Extract<TreeRowModel, { kind: 'node' }>;

const DRAG_MIME = 'application/x-modelica-class';

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}

export function ClassTree(props: ClassTreeProps) {
  const { registry, registryVersion, sections, filter, markers, childrenOf, onContextMenu, headerActions } = props;
  const activeClass = useStore((s) => s.activeClass);
  const [expanded, setExpanded] = useSessionSet(`impact-clone:${props.workspaceId ?? 'none'}:workspace-panel:expanded`);
  const [focused, setFocused] = useState<string | undefined>(activeClass);
  const containerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<string | undefined>(undefined);

  const rows = useMemo(
    () => flattenTree(sections, { expanded, childrenOf, visible: filter?.visible }),
    // registryVersion is part of the key because childrenOf reads the (mutable) registry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, expanded, childrenOf, filter, registryVersion],
  );
  const nodeRows = useMemo(() => rows.filter((r): r is NodeRow => r.kind === 'node'), [rows]);

  const scrollTo = useCallback((name: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-name="${cssEscape(name)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, []);

  // Auto-expand the path to the active class, focus it and scroll it into view once rendered.
  useEffect(() => {
    if (!activeClass) return;
    const ancestors = ancestorsOf(activeClass);
    setExpanded((prev) => {
      if (ancestors.every((a) => prev.has(a))) return prev;
      const next = new Set(prev);
      for (const a of ancestors) next.add(a);
      return next;
    });
    setFocused(activeClass);
    pendingScroll.current = activeClass;
  }, [activeClass, setExpanded]);

  useEffect(() => {
    const name = pendingScroll.current;
    if (!name) return;
    if (nodeRows.some((r) => r.node.name === name)) {
      pendingScroll.current = undefined;
      scrollTo(name);
    }
  }, [nodeRows, scrollTo]);

  const setNodeExpanded = useCallback(
    (name: string, value: boolean) => {
      setExpanded((prev) => {
        if (prev.has(name) === value) return prev;
        const next = new Set(prev);
        if (value) next.add(name);
        else next.delete(name);
        return next;
      });
    },
    [setExpanded],
  );

  const filtering = !!filter;
  const onToggle = useCallback(
    (name: string) => {
      if (filtering) return; // every shown package is expanded while filtering
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    },
    [filtering, setExpanded],
  );
  const onActivate = useCallback((name: string) => useStore.getState().openClass(name), []);
  const onFocusRow = useCallback((name: string) => setFocused(name), []);

  const onDragStart = useCallback((e: DragEvent, node: ClassTreeNode) => {
    e.dataTransfer.setData(DRAG_MIME, node.name);
    e.dataTransfer.setData('text/plain', node.name);
    e.dataTransfer.effectAllowed = 'copy';
    const ghost = ghostRef.current;
    const svg = (e.currentTarget as HTMLElement).querySelector('svg');
    if (ghost && svg) {
      ghost.innerHTML = '';
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute('width', '32');
      clone.setAttribute('height', '32');
      ghost.appendChild(clone);
      try {
        e.dataTransfer.setDragImage(ghost, 16, 16);
      } catch {
        /* not supported */
      }
    }
  }, []);
  const onDragEnd = useCallback(() => {
    if (ghostRef.current) ghostRef.current.innerHTML = '';
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // ignore keys from nested buttons/inputs
    if (!nodeRows.length) return;
    const idx = focused ? nodeRows.findIndex((r) => r.node.name === focused) : -1;
    const current = idx >= 0 ? nodeRows[idx] : undefined;
    const focusIndex = (i: number) => {
      const row = nodeRows[Math.max(0, Math.min(nodeRows.length - 1, i))];
      setFocused(row.node.name);
      scrollTo(row.node.name);
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusIndex(idx < 0 ? 0 : idx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusIndex(idx < 0 ? 0 : idx - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (!current) focusIndex(0);
        else if (current.node.hasChildren && !current.expanded) setNodeExpanded(current.node.name, true);
        else if (current.expanded && idx + 1 < nodeRows.length && nodeRows[idx + 1].depth === current.depth + 1) focusIndex(idx + 1);
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (!current) {
          focusIndex(0);
          break;
        }
        if (current.expanded && !filtering) {
          setNodeExpanded(current.node.name, false);
          break;
        }
        for (let i = idx - 1; i >= 0; i--) {
          if (nodeRows[i].depth === current.depth - 1) {
            focusIndex(i);
            break;
          }
        }
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (current) onActivate(current.node.name);
        break;
      case 'Home':
        e.preventDefault();
        focusIndex(0);
        break;
      case 'End':
        e.preventDefault();
        focusIndex(nodeRows.length - 1);
        break;
      default:
        return;
    }
  };

  const noMatches = filtering && nodeRows.length === 0;
  const query = filter?.query ?? '';

  return (
    <div
      ref={containerRef}
      className="wp-tree"
      role="tree"
      tabIndex={0}
      aria-label="Workspace classes"
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (!focused && nodeRows.length) setFocused(activeClass ?? nodeRows[0].node.name);
      }}
    >
      {noMatches ? (
        <div className="wp-empty">No classes match</div>
      ) : (
        rows.map((row) => {
          switch (row.kind) {
            case 'header':
              return (
                <div key={row.key} className="section-title wp-section" role="presentation">
                  <span className="wp-section-title">{row.title}</span>
                  <span className="wp-section-actions">{headerActions?.[row.section]}</span>
                </div>
              );
            case 'node':
              return (
                <TreeRow
                  key={row.key}
                  node={row.node}
                  depth={row.depth}
                  expanded={row.expanded}
                  isRoot={row.isRoot}
                  active={row.node.name === activeClass}
                  focused={row.node.name === focused}
                  errorState={errorStateOf(registry, markers, row.node.name)}
                  query={query}
                  onToggle={onToggle}
                  onActivate={onActivate}
                  onFocusRow={onFocusRow}
                  onContextMenu={onContextMenu}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              );
            case 'broken':
              return (
                <div key={row.key} className="wp-row wp-row-broken" role="treeitem" aria-level={1} title={row.library.message} style={{ paddingLeft: 4 }}>
                  <span className="wp-chevron wp-chevron-spacer" />
                  <span className="wp-icon wp-icon-broken">!</span>
                  <span className="wp-name">{row.library.name}</span>
                  <span className="wp-dot" />
                  <span className="wp-desc">{row.library.message}</span>
                </div>
              );
            case 'empty':
              return (
                <div key={row.key} className="wp-empty wp-empty-section">
                  {row.text}
                </div>
              );
            default:
              return null;
          }
        })
      )}
      {filter?.truncated && <div className="wp-footer">Showing the first {filter.matchCount} matches — refine the filter to see more.</div>}
      <div ref={ghostRef} className="wp-drag-ghost" aria-hidden="true" />
    </div>
  );
}
