/**
 * COMPONENTS tab (UI_SPEC §6.3): every component of the active model; click selects it on the
 * canvas, double-click opens its class.
 */
import type { ComponentView } from '@impact/core';
import { IconSvg } from '../graphics/GraphicsLayerSvg';
import { useStore } from '../../store';

export interface ComponentsTabProps {
  components: ComponentView[];
  selection: string[];
}

export function ComponentsTab({ components, selection }: ComponentsTabProps) {
  const select = useStore((s) => s.select);
  const openClass = useStore((s) => s.openClass);
  if (!components.length) return <div className="details-empty">No components.</div>;
  return (
    <div className="components-list" role="listbox" aria-label="Components">
      {components.map((c) => {
        const selected = selection.includes(c.name);
        return (
          <button
            key={c.name}
            type="button"
            role="option"
            aria-selected={selected}
            className={`component-row${selected ? ' selected' : ''}${c.disabled ? ' disabled' : ''}`}
            onClick={() => select([c.name])}
            onDoubleClick={() => openClass(c.className)}
            title={`${c.name}: ${c.className}${c.description ? `\n${c.description}` : ''}`}
          >
            <span className="component-row-icon">
              <IconSvg icon={c.icon} size={20} hideText />
            </span>
            <span className="component-row-text">
              <span className="component-row-name">
                <span>{c.name}</span>
                <span className="component-row-class">{c.shortClassName}</span>
              </span>
              {c.description && <span className="component-row-desc">{c.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
