/**
 * Details panel (right sidebar, UI_SPEC §6): header, mode-dependent tabs and tab bodies.
 * The shell renders it inside a resizable container; the panel fills the height and the tab
 * body scrolls.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import { CalculatedValuesTab } from '../results/CalculatedValuesTab';
import { SimulationsTab } from '../results/SimulationsTab';
import { useStore } from '../../store';
import { ComponentsTab } from './ComponentsTab';
import { DetailsHeader } from './DetailsHeader';
import { ExperimentTab } from './ExperimentTab';
import { InformationTab } from './InformationTab';
import { PropertiesTab } from './PropertiesTab';
import { TABS_BY_MODE, resolveTab } from './helpers';
import './details.css';

export function DetailsPanel(): JSX.Element {
  const activeClass = useStore((s) => s.activeClass);
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const diagram = useStore((s) => s.diagram);
  const detailsTab = useStore((s) => s.detailsTab);
  const setDetailsTab = useStore((s) => s.setDetailsTab);
  const select = useStore((s) => s.select);
  const registry = useStore((s) => s.registry);
  const registryVersion = useStore((s) => s.registryVersion);

  const readOnly = useMemo(() => {
    void registryVersion;
    return activeClass ? registry.isReadOnly(activeClass) : true;
  }, [registry, registryVersion, activeClass]);
  const restriction = useMemo(() => {
    void registryVersion;
    return activeClass ? registry.get(activeClass)?.def.restriction : undefined;
  }, [registry, registryVersion, activeClass]);

  if (!activeClass) {
    return (
      <div className="details-panel details-panel--empty">
        <div className="details-empty-title">No class selected</div>
        <div>Open a class from the Libraries panel to see its properties.</div>
      </div>
    );
  }

  const components = diagram?.components ?? [];
  const selectedComponents = selection.map((n) => components.find((c) => c.name === n)).filter((c): c is NonNullable<typeof c> => !!c);
  const component = selectedComponents.length === 1 ? selectedComponents[0] : undefined;
  const multi = selectedComponents.length > 1;
  const tabs = TABS_BY_MODE[mode];
  const tab = resolveTab(mode, detailsTab);

  let body: JSX.Element;
  switch (tab) {
    case 'PROPERTIES':
      body = multi ? (
        <div className="multi-selection">
          {selectedComponents.length} components selected. Select a single component to edit its parameters.
          <ul>
            {selectedComponents.map((c) => (
              <li key={c.name}>
                <button type="button" onClick={() => select([c.name])}>
                  {c.name}
                </button>{' '}
                <span>({c.shortClassName})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <PropertiesTab key={`${activeClass}/${component?.name ?? ''}/${mode}`} activeClass={activeClass} component={component} mode={mode} readOnly={readOnly} />
      );
      break;
    case 'INFORMATION':
      body = <InformationTab className={component?.className ?? activeClass} />;
      break;
    case 'COMPONENTS':
      body = <ComponentsTab components={components} selection={selection} />;
      break;
    case 'EXPERIMENT':
      body = <ExperimentTab className={activeClass} />;
      break;
    case 'SIMULATIONS':
      body = <SimulationsTab />;
      break;
    case 'CALCULATED VALUES':
      body = <CalculatedValuesTab />;
      break;
    default:
      body = <div className="details-empty">Unknown tab.</div>;
  }
  const fill = tab === 'SIMULATIONS' || tab === 'CALCULATED VALUES';

  return (
    <div className="details-panel" data-tab={tab}>
      <DetailsHeader activeClass={activeClass} component={component} selectionCount={selectedComponents.length} icon={component ? component.icon : diagram?.icon} restriction={restriction} readOnly={readOnly} />
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" className={`tab${t === tab ? ' active' : ''}`} aria-selected={t === tab} onClick={() => setDetailsTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className={`details-body${fill ? ' details-body--fill' : ''}`}>{body}</div>
    </div>
  );
}

export default DetailsPanel;
