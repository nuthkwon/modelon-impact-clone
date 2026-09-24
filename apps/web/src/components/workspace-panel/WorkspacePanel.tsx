/**
 * Workspace panel (left sidebar, UI_SPEC §4): filter row, PROJECTS tree of the editable
 * projects and LIBRARIES tree of the read-only dependencies. The shell renders the collapsed
 * strip; this component renders the open panel only and fills the height it is given.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ClassTreeNode } from '@impact/core';
import { Icon } from '../icons';
import { Tooltip } from '../common/Tooltip';
import { useShellActions } from '../shell/shellActions';
import { useStore } from '../../store';
import { ClassTree } from './ClassTree';
import type { TreeFilter } from './ClassTree';
import { ConfigureWorkspaceDialog } from './ConfigureWorkspaceDialog';
import { LimitLibrariesPopover } from './LimitLibrariesPopover';
import { useClassActions } from './classActions';
import { useDebounced, useSessionSet } from './hooks';
import { MAX_MATCHES, brokenLibraries, cachedChildren, createChildrenCache, errorMarkers, searchNodes, splitSections, withAncestors } from './treeModel';
import './workspace-panel.css';

export function WorkspacePanel(): JSX.Element {
  const workspaceId = useStore((s) => s.workspaceId);
  const registry = useStore((s) => s.registry);
  const registryVersion = useStore((s) => s.registryVersion);
  const fileDiagnostics = useStore((s) => s.fileDiagnostics);
  const shell = useShellActions();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 150);
  const [hiddenLibraries, setHiddenLibraries] = useSessionSet(`impact-clone:${workspaceId ?? 'none'}:workspace-panel:hidden-libraries`);
  const [limitOpen, setLimitOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const cacheRef = useRef(createChildrenCache());

  const childrenOf = useCallback((name: string) => cachedChildren(cacheRef.current, registry, registryVersion, name), [registry, registryVersion]);

  const libraries = useMemo(() => registry.listLibraries(), [registry, registryVersion]);
  const markers = useMemo(() => errorMarkers(registry, fileDiagnostics), [registry, registryVersion, fileDiagnostics]);
  const sections = useMemo(() => {
    const top = cachedChildren(cacheRef.current, registry, registryVersion, undefined);
    return splitSections(top, libraries, hiddenLibraries, brokenLibraries(registry, fileDiagnostics));
  }, [registry, registryVersion, libraries, hiddenLibraries, fileDiagnostics]);

  const filter = useMemo<TreeFilter | undefined>(() => {
    const q = debouncedQuery.trim();
    if (!q) return undefined;
    const includeLibrary = hiddenLibraries.size ? (id: string) => !hiddenLibraries.has(id) : undefined;
    const matches = searchNodes(registry, q, { limit: MAX_MATCHES, includeLibrary });
    return { query: q, visible: withAncestors(matches.map((m) => m.name)), matchCount: matches.length, truncated: matches.length >= MAX_MATCHES };
  }, [debouncedQuery, registry, registryVersion, hiddenLibraries]);

  const openConfigure = useCallback(() => setConfigureOpen(true), []);
  const actions = useClassActions({ onConfigureWorkspace: openConfigure });
  const onContextMenu = useCallback(
    (e: React.MouseEvent, node: ClassTreeNode, isProjectRoot: boolean) => actions.openMenu(e, node, isProjectRoot),
    [actions],
  );

  const toggleLibrary = useCallback(
    (id: string) =>
      setHiddenLibraries((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [setHiddenLibraries],
  );
  const showAllLibraries = useCallback(() => setHiddenLibraries((prev) => (prev.size ? new Set<string>() : prev)), [setHiddenLibraries]);
  const closeLimit = useCallback(() => setLimitOpen(false), []);

  const headerActions = useMemo(
    () => ({
      projects: (
        <Tooltip text="Configure workspace">
          <button type="button" className="icon-button wp-section-button" aria-label="Configure workspace" onClick={openConfigure}>
            <Icon.Settings />
          </button>
        </Tooltip>
      ),
    }),
    [openConfigure],
  );

  return (
    <div className="workspace-panel">
      <div className="wp-toolbar">
        <div className={`wp-filter ${query ? 'has-value' : ''}`.trim()}>
          <span className="wp-filter-icon">
            <Icon.Search />
          </span>
          <input
            ref={filterInputRef}
            className="text-field wp-filter-input"
            type="text"
            placeholder="Filter"
            aria-label="Filter classes"
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="wp-filter-clear"
              aria-label="Clear filter"
              onClick={() => {
                setQuery('');
                filterInputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
        </div>
        <Tooltip text="Limit libraries">
          <button
            type="button"
            className={`icon-button wp-funnel ${hiddenLibraries.size ? 'active' : ''}`.trim()}
            aria-label="Limit libraries"
            aria-expanded={limitOpen}
            onClick={() => setLimitOpen((o) => !o)}
          >
            <Icon.FilterList />
          </button>
        </Tooltip>
        <Tooltip text="Create class">
          <button type="button" className="icon-button" aria-label="Create class" onClick={() => shell.openNewClassDialog()}>
            <Icon.Add />
          </button>
        </Tooltip>
        {limitOpen && <LimitLibrariesPopover libraries={libraries} hidden={hiddenLibraries} onToggle={toggleLibrary} onShowAll={showAllLibraries} onClose={closeLimit} />}
      </div>
      <ClassTree
        workspaceId={workspaceId}
        registry={registry}
        registryVersion={registryVersion}
        sections={sections}
        filter={filter}
        markers={markers}
        childrenOf={childrenOf}
        onContextMenu={onContextMenu}
        headerActions={headerActions}
      />
      <ConfigureWorkspaceDialog open={configureOpen} onClose={() => setConfigureOpen(false)} />
      {actions.dialog}
    </div>
  );
}

export default WorkspacePanel;
