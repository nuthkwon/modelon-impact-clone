/**
 * INFORMATION tab (UI_SPEC §6.2): sanitised `Documentation(info=…)` HTML of a class, with the
 * class description as fallback and a collapsible "Revisions" section.
 */
import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { parseDocumentation } from '@impact/core';
import { Icon } from '../icons';
import { useStore } from '../../store';
import { hasVisibleContent, modelicaLinkTarget, sanitizeHtml } from './helpers';

export interface InformationTabProps {
  className: string;
}

export function InformationTab({ className }: InformationTabProps) {
  const registry = useStore((s) => s.registry);
  const registryVersion = useStore((s) => s.registryVersion);
  const openClass = useStore((s) => s.openClass);
  const [revisionsOpen, setRevisionsOpen] = useState(false);

  const { info, revisions, description } = useMemo(() => {
    void registryVersion;
    const cls = registry.get(className);
    const doc = parseDocumentation(cls?.def.annotation);
    const info = doc?.info ? sanitizeHtml(doc.info) : '';
    const revisions = doc?.revisions ? sanitizeHtml(doc.revisions) : '';
    return { info: hasVisibleContent(info) ? info : '', revisions: hasVisibleContent(revisions) ? revisions : '', description: cls?.def.description };
  }, [registry, registryVersion, className]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (!href) return;
    e.preventDefault();
    const target = modelicaLinkTarget(href);
    if (target) {
      const resolved = registry.has(target) ? target : registry.lookup(target, className)?.fullName;
      if (resolved) openClass(resolved);
      return;
    }
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="information-tab">
      {info ? (
        <div className="doc-html" onClick={onClick} dangerouslySetInnerHTML={{ __html: info }} />
      ) : description ? (
        <div className="doc-fallback">
          <div className="doc-fallback-label">Description</div>
          <div>{description}</div>
        </div>
      ) : (
        <div className="details-empty">No documentation available.</div>
      )}
      {revisions && (
        <div className="doc-revisions">
          <button type="button" className={`details-group-header${revisionsOpen ? '' : ' collapsed'}`} onClick={() => setRevisionsOpen((o) => !o)} aria-expanded={revisionsOpen}>
            <Icon.ExpandMore />
            <span>Revisions</span>
          </button>
          {revisionsOpen && <div className="doc-html" onClick={onClick} dangerouslySetInnerHTML={{ __html: revisions }} />}
        </div>
      )}
    </div>
  );
}
