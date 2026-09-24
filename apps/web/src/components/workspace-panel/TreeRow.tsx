/**
 * One row of the class tree. Memoised: it only re-renders when its own props change
 * (active/focused flags, expansion, error state or the node itself).
 */
import { memo } from 'react';
import type { DragEvent, MouseEvent, ReactNode } from 'react';
import type { ClassTreeNode } from '@impact/core';
import { Icon } from '../icons';
import { ClassIcon } from './ClassIcon';
import { highlightParts, matchesQuery } from './treeModel';
import type { ErrorState } from './treeModel';

export interface TreeRowHandlers {
  onToggle(name: string): void;
  onActivate(name: string): void;
  onFocusRow(name: string): void;
  onContextMenu(e: MouseEvent, node: ClassTreeNode, isRoot: boolean): void;
  onDragStart(e: DragEvent, node: ClassTreeNode): void;
  onDragEnd(e: DragEvent): void;
}

export interface TreeRowProps extends TreeRowHandlers {
  node: ClassTreeNode;
  depth: number;
  expanded: boolean;
  isRoot: boolean;
  active: boolean;
  focused: boolean;
  errorState: ErrorState;
  /** Filter query (highlights matches); empty when not filtering. */
  query: string;
}

function Highlighted({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text;
  const parts = highlightParts(text, query);
  if (parts.length === 1 && !parts[0].match) return text;
  return parts.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>));
}

export const TreeRow = memo(function TreeRow(props: TreeRowProps) {
  const { node, depth, expanded, isRoot, active, focused, errorState, query } = props;
  const classes = ['wp-row'];
  if (active) classes.push('active');
  if (focused) classes.push('focused');
  if (node.partial) classes.push('partial');
  if (node.readOnly) classes.push('read-only');
  const showDescription = !!query && !!node.description && !matchesQuery(node.shortName, undefined, query.toLowerCase());
  const tooltip = node.description ? `${node.description}\n${node.name}` : node.name;

  return (
    <div
      role="treeitem"
      className={classes.join(' ')}
      style={{ paddingLeft: 4 + depth * 16 }}
      data-name={node.name}
      title={tooltip}
      aria-level={depth + 1}
      aria-expanded={node.hasChildren ? expanded : undefined}
      aria-selected={active}
      draggable={node.droppable || undefined}
      onClick={(e) => {
        if (e.detail > 1) return; // handled by onDoubleClick
        props.onFocusRow(node.name);
        props.onActivate(node.name);
      }}
      onDoubleClick={() => {
        props.onActivate(node.name);
        if (node.hasChildren) props.onToggle(node.name);
      }}
      onContextMenu={(e) => {
        props.onFocusRow(node.name);
        props.onContextMenu(e, node, isRoot);
      }}
      onDragStart={node.droppable ? (e) => props.onDragStart(e, node) : undefined}
      onDragEnd={node.droppable ? props.onDragEnd : undefined}
    >
      {node.hasChildren ? (
        <button
          type="button"
          className="wp-chevron"
          tabIndex={-1}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle(node.name);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {expanded ? <Icon.ExpandMore /> : <Icon.ChevronRight />}
        </button>
      ) : (
        <span className="wp-chevron wp-chevron-spacer" />
      )}
      <ClassIcon icon={node.icon} restriction={node.restriction} />
      <span className="wp-name">
        <Highlighted text={node.shortName} query={query} />
      </span>
      {errorState !== 'none' && <span className={`wp-dot ${errorState === 'contains' ? 'contains' : ''}`.trim()} title={errorState === 'own' ? 'Syntax error in this file' : 'Contains files with syntax errors'} />}
      {showDescription && (
        <span className="wp-desc">
          <Highlighted text={node.description!} query={query} />
        </span>
      )}
    </div>
  );
});
