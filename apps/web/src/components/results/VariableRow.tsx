/**
 * One variable row: name, value at the slider time (right-aligned, 6 significant digits),
 * unit, hover actions (Add to plot / sticky eye / favorite star). Draggable as
 * `application/x-impact-variable` with `{ resultId, variable }`.
 */
import type { DragEvent, JSX, ReactNode } from 'react';
import { formatNumber, unitLabel } from '@impact/core';
import { displayInfo } from './resultMeta';
import { useStore } from '../../store';
import { Tooltip } from '../common/Tooltip';
import { Icon } from '../icons';
import { setVariableDrag } from '../plots/dragTypes';
import { useVariableValue } from './variableHooks';
import type { VariableActions } from './variableHooks';
import './results.css';

export interface VariableRowProps {
  /** Fully-qualified variable name. */
  variable: string;
  /** Display text (defaults to the full name). */
  label?: string;
  depth?: number;
  unit?: string;
  /** `displayUnit` attribute; values are converted when display units are enabled in the settings. */
  displayUnit?: string;
  description?: string;
  resultId?: string;
  caseId?: string;
  favorite?: boolean;
  actions: VariableActions;
  /** Slot before the name (tree chevron / spacer). */
  leading?: ReactNode;
  /** Highlight (e.g. filter match). */
  highlight?: string;
}

function Highlight({ text, needle }: { text: string; needle?: string }): JSX.Element {
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

export function VariableRow({ variable, label, depth = 0, unit, displayUnit, description, resultId, caseId, favorite = false, actions, leading, highlight }: VariableRowProps): JSX.Element {
  const { value, loaded } = useVariableValue(variable, resultId, caseId);
  const showDisplayUnits = useStore((s) => s.settings.showDisplayUnits);
  const disp = displayInfo(unit, displayUnit, showDisplayUnits);
  const hasResult = Boolean(resultId && caseId);
  const text = !hasResult ? '–' : loaded ? (value !== undefined && Number.isFinite(value) ? formatNumber(disp.convert(value), 6) : '–') : '…';

  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    setVariableDrag(e.dataTransfer, { resultId, variable });
  };

  return (
    <div
      className={`var-row${favorite ? ' favorite' : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      draggable
      onDragStart={onDragStart}
      title={description ? `${variable}\n${description}` : variable}
      data-variable={variable}
    >
      {leading}
      <span className="var-name">
        <Highlight text={label ?? variable} needle={highlight} />
      </span>
      <span className={`var-value${loaded ? '' : ' pending'}`}>{text}</span>
      <span className="var-unit">{disp.unit ? unitLabel(disp.unit) : ''}</span>
      <span className="var-actions">
        <Tooltip text="Add Variable to Plot">
          <button type="button" className="var-action" onClick={() => actions.addToPlot(variable)} aria-label={`Add ${variable} to plot`}>
            <Icon.Plot />
          </button>
        </Tooltip>
        <Tooltip text="Show value on the canvas">
          <button type="button" className="var-action" onClick={() => actions.addSticky(variable)} aria-label={`Show ${variable} on the canvas`}>
            <Icon.Eye />
          </button>
        </Tooltip>
        <Tooltip text={favorite ? 'Remove from favorites' : 'Add to favorites'}>
          <button
            type="button"
            className={`var-action star${favorite ? ' on' : ''}`}
            onClick={() => actions.toggleFavorite(variable)}
            aria-pressed={favorite}
            aria-label={favorite ? `Remove ${variable} from favorites` : `Add ${variable} to favorites`}
          >
            {favorite ? <Icon.Star /> : <Icon.StarBorder />}
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
