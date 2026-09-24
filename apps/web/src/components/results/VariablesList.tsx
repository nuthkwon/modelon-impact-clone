/**
 * Flat, reusable list of variable rows (name, value at the slider time, unit, hover actions,
 * draggable). Rendered by the Details panel's PROPERTIES → "Variables" sub-tab; values come
 * from the active result / selected case of the active class.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import { useStore } from '../../store';
import { unitOf, useCaseMeta } from './resultMeta';
import { useActiveResultCase, useBatchTrajectories, useFavorites, useVariableActions } from './variableHooks';
import { VariableRow } from './VariableRow';
import './results.css';

export interface VariablesListItem {
  name: string;
  unit?: string;
  description?: string;
}

export interface VariablesListProps {
  variables: VariablesListItem[];
  /** Cap on rendered rows (a note is shown beyond it). */
  maxRows?: number;
}

export function VariablesList({ variables, maxRows = 500 }: VariablesListProps): JSX.Element {
  const className = useStore((s) => s.activeClass);
  const { result, caseId } = useActiveResultCase(className);
  const meta = useCaseMeta(result?.id, caseId);
  const actions = useVariableActions(className);
  const favorites = useFavorites(className);

  const shown = useMemo(() => variables.slice(0, maxRows), [variables, maxRows]);
  const names = useMemo(() => shown.map((v) => v.name), [shown]);
  useBatchTrajectories(result?.id, caseId, names);

  if (!variables.length) return <div className="results-empty">No variables.</div>;

  return (
    <div className="var-list" role="list" aria-label="Variables">
      <div className="var-header" aria-hidden="true">
        <span className="var-name">Name</span>
        <span className="var-value">Value</span>
        <span className="var-unit">Unit</span>
        <span className="var-actions" />
      </div>
      {shown.map((v) => (
        <VariableRow
          key={v.name}
          variable={v.name}
          unit={v.unit ?? unitOf(meta, v.name)}
          description={v.description ?? meta?.get(v.name)?.description}
          resultId={result?.id}
          caseId={caseId}
          favorite={favorites.includes(v.name)}
          actions={actions}
        />
      ))}
      {variables.length > shown.length && (
        <div className="calc-note">
          Showing {shown.length} of {variables.length} variables.
        </div>
      )}
    </div>
  );
}
