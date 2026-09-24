/**
 * CALCULATED VALUES tab (docs/UI_SPEC.md §6.6): text + type filter over a tree that follows the
 * model hierarchy; rows show the value at the slider time and unit, with plot / sticky /
 * favorite hover actions, and are draggable as `application/x-impact-variable`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useStore } from '../../store';
import { Icon } from '../icons';
import { unitOf, useCaseMeta } from './resultMeta';
import { useActiveResultCase, useBatchTrajectories, useFavorites, useVariableActions } from './variableHooks';
import { VariableRow } from './VariableRow';
import { TYPE_FILTERS, buildVariableTree, classifyVariable, flattenTree, matchesTypeFilter, pruneTree } from './variableTree';
import type { TreeNode, TypeFilter } from './variableTree';
import './results.css';

const MAX_ROWS = 500;
const EXPANDED_KEY = (className: string) => `impact-clone:calc-expanded:${className}`;

function loadExpanded(className: string | undefined): Set<string> | undefined {
  if (!className) return undefined;
  try {
    const raw = localStorage.getItem(EXPANDED_KEY(className));
    if (!raw) return undefined;
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : undefined;
  } catch {
    return undefined;
  }
}

function saveExpanded(className: string | undefined, set: Set<string>): void {
  if (!className) return;
  try {
    localStorage.setItem(EXPANDED_KEY(className), JSON.stringify([...set]));
  } catch {
    /* ignore quota / private mode */
  }
}

function FolderRow({ node, depth, expanded, onToggle }: { node: TreeNode; depth: number; expanded: boolean; onToggle: () => void }): JSX.Element {
  return (
    <div
      className="var-row folder"
      style={{ paddingLeft: 8 + depth * 16 }}
      role="treeitem"
      aria-expanded={expanded}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowRight' && !expanded) || (e.key === 'ArrowLeft' && expanded)) {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="var-chevron">{expanded ? <Icon.ExpandMore /> : <Icon.ChevronRight />}</span>
      <span className="var-name">{node.name}</span>
    </div>
  );
}

export function CalculatedValuesTab(): JSX.Element {
  const className = useStore((s) => s.activeClass);
  const { result, caseId, caseIndex } = useActiveResultCase(className);
  const setCaseIndex = useStore((s) => s.setCaseIndex);
  const fetchResultVariables = useStore((s) => s.fetchResultVariables);
  const variables = useStore((s) => (result ? s.resultVariables[result.id] : undefined));
  const [listError, setListError] = useState<string | undefined>();
  const meta = useCaseMeta(result?.id, caseId);
  const actions = useVariableActions(className);
  const favorites = useFavorites(className);

  const [filter, setFilter] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const needle = filter.trim().toLowerCase();

  // Variable list of the active result.
  useEffect(() => {
    if (!result || variables) return;
    let alive = true;
    setListError(undefined);
    fetchResultVariables(result.id).catch((e: unknown) => {
      if (alive) setListError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      alive = false;
    };
  }, [result, variables, fetchResultVariables]);

  // Expanded folders, persisted per class; top-level components open by default.
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(className) ?? new Set());
  const hadPersisted = useRef(loadExpanded(className) !== undefined);
  useEffect(() => {
    const loaded = loadExpanded(className);
    hadPersisted.current = loaded !== undefined;
    setExpanded(loaded ?? new Set());
  }, [className]);

  const tree = useMemo(() => buildVariableTree(variables ?? []), [variables]);
  useEffect(() => {
    if (hadPersisted.current || !tree.length) return;
    hadPersisted.current = true;
    const roots = new Set(tree.filter((n) => n.children.length).map((n) => n.key));
    setExpanded(roots);
    saveExpanded(className, roots);
  }, [tree, className]);

  const toggle = useCallback(
    (key: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        saveExpanded(className, next);
        return next;
      });
    },
    [className],
  );

  // Classification needs trajectory lengths only when meta is unavailable and a type filter is set.
  const trajectories = useStore((s) => (type !== 'all' && !meta ? s.trajectories : undefined));
  const derivatives = useMemo(() => new Set((variables ?? []).filter((v) => v.startsWith('der(') && v.endsWith(')')).map((v) => v.slice(4, -1))), [variables]);

  const filtered = useMemo(() => {
    if (!needle && type === 'all') return tree;
    return pruneTree(tree, (v) => {
      if (needle && !v.toLowerCase().includes(needle)) return false;
      if (type === 'all') return true;
      const kind = classifyVariable(v, {
        metaKind: meta?.get(v)?.kind,
        trajectoryLength: trajectories && result && caseId ? trajectories[`${result.id}/${caseId}/${v}`]?.length : undefined,
        hasDerivative: derivatives.has(v),
      });
      return matchesTypeFilter(kind, type);
    });
  }, [tree, needle, type, meta, trajectories, derivatives, result, caseId]);

  const { rows, total } = useMemo(() => flattenTree(filtered, expanded, needle.length > 0, MAX_ROWS), [filtered, expanded, needle]);
  const leafVariables = useMemo(() => rows.filter((r) => r.isLeaf && r.node.variable).map((r) => r.node.variable as string), [rows]);
  useBatchTrajectories(result?.id, caseId, leafVariables);

  const multiCase = Boolean(result && result.cases.length > 1);

  let body: JSX.Element;
  if (!className) {
    body = <div className="results-empty">Open a model to see its calculated values.</div>;
  } else if (!result) {
    body = <div className="results-empty">No results yet. Press the Play button to simulate.</div>;
  } else if (listError) {
    body = <div className="results-empty results-error">Could not load the result variables: {listError}</div>;
  } else if (!variables) {
    body = (
      <div className="calc-status">
        <span className="results-spinner" aria-hidden="true" /> Loading variables…
      </div>
    );
  } else if (!rows.length) {
    body = <div className="results-empty">{variables.length ? 'No variables match the filter.' : 'The result contains no variables.'}</div>;
  } else {
    body = (
      <div className="var-list calc-tree" role="tree" aria-label="Calculated values">
        {rows.map((r) =>
          r.isLeaf && r.node.variable ? (
            <VariableRow
              key={r.node.key}
              variable={r.node.variable}
              label={r.node.name}
              depth={r.depth}
              unit={unitOf(meta, r.node.variable)}
              description={meta?.get(r.node.variable)?.description}
              resultId={result.id}
              caseId={caseId}
              favorite={favorites.includes(r.node.variable)}
              actions={actions}
              leading={<span className="var-spacer" />}
              highlight={needle || undefined}
            />
          ) : (
            <FolderRow key={r.node.key} node={r.node} depth={r.depth} expanded={r.expanded} onToggle={() => toggle(r.node.key)} />
          ),
        )}
        {total > rows.length && (
          <div className="calc-note">
            Showing {rows.length} of {total} rows — refine the filter to see more.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="calc-tab">
      {multiCase && result && (
        <div className="calc-case-row">
          <label htmlFor="calc-case-select">Case:</label>
          <select id="calc-case-select" value={caseIndex} onChange={(e) => setCaseIndex(Number(e.target.value))}>
            {result.cases.map((c, i) => (
              <option key={c.id} value={i}>
                {c.meta?.label || `case_${i + 1}`}
                {c.run_info.status === 'failed' ? ' (failed)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="calc-filters">
        <div className="calc-search">
          <Icon.Search />
          <input
            className="text-field"
            type="search"
            placeholder="Filter variables"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter variables"
            disabled={!result}
          />
        </div>
        <select className="calc-type" value={type} onChange={(e) => setType(e.target.value as TypeFilter)} aria-label="Variable type" disabled={!result}>
          {TYPE_FILTERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {body}
    </div>
  );
}
