/**
 * PROPERTIES tab (UI_SPEC §6.1): filter chips, `Dialog(tab)` sub-tabs, `Dialog(group)`
 * collapsible groups of parameter rows and the trailing "Variables" sub-tab.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ComponentView, ParameterInfo, VariableInfo } from '@impact/core';
import { getParameters, getVariables, unitLabel } from '@impact/core';
import { Icon } from '../icons';
import { VariablesList } from '../results/VariablesList';
import { useStore } from '../../store';
import type { Mode } from '../../store/types';
import { ParameterRow } from './ParameterRow';
import {
  ATTRIBUTE_NAMES,
  DEFAULT_DIALOG_TAB,
  VARIABLES_TAB,
  attributeValue,
  filterParameters,
  fullVariableName,
  groupParameters,
  hasAttributeModifier,
} from './helpers';
import type { AttributeName, ParameterTab } from './helpers';

export interface PropertiesTabProps {
  activeClass: string;
  /** The single selected component; undefined shows the parameters of the active class itself. */
  component?: ComponentView;
  mode: Mode;
  readOnly: boolean;
}

interface Chips {
  parameters: boolean;
  results: boolean;
  favorites: boolean;
}

function useParameters(activeClass: string, component: ComponentView | undefined): ParameterInfo[] {
  const registry = useStore((s) => s.registry);
  const registryVersion = useStore((s) => s.registryVersion);
  return useMemo(() => {
    void registryVersion;
    try {
      if (component) return getParameters(registry, component.className, { ownerClassName: activeClass, componentName: component.name });
      return getParameters(registry, activeClass);
    } catch {
      return component?.parameters ?? [];
    }
  }, [registry, registryVersion, activeClass, component]);
}

function useVariables(className: string): VariableInfo[] {
  const registry = useStore((s) => s.registry);
  const registryVersion = useStore((s) => s.registryVersion);
  return useMemo(() => {
    void registryVersion;
    try {
      return getVariables(registry, className);
    } catch {
      return [];
    }
  }, [registry, registryVersion, className]);
}

export function PropertiesTab({ activeClass, component, mode, readOnly }: PropertiesTabProps) {
  const componentName = component?.name;
  const targetClass = component?.className ?? activeClass;
  const params = useParameters(activeClass, component);
  const variables = useVariables(targetClass);

  const applyEdit = useStore((s) => s.applyEdit);
  const setModifier = useStore((s) => s.setModifier);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const addSticky = useStore((s) => s.addSticky);
  const favorites = useStore((s) => s.favorites[activeClass]) ?? [];
  const showDisplayUnits = useStore((s) => s.settings.showDisplayUnits);
  const experiments = useStore((s) => s.experiments);
  const activeExperimentId = useStore((s) => s.activeExperiment[activeClass]);
  const exp = useMemo(() => experiments.find((e) => e.id === activeExperimentId) ?? experiments.find((e) => e.className === activeClass), [experiments, activeExperimentId, activeClass]);

  // Result values re-render with the trajectory cache, slider and active result.
  const valueAt = useStore((s) => s.valueAt);
  useStore((s) => s.trajectories);
  useStore((s) => s.sliderTime);
  useStore((s) => s.caseIndex);
  useStore((s) => s.activeResult[activeClass]);
  useStore((s) => s.results);

  const [chips, setChips] = useState<Chips>({ parameters: true, results: true, favorites: false });
  const [text, setText] = useState('');
  const [subTab, setSubTab] = useState<string>(DEFAULT_DIALOG_TAB);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const experimentModifiers = mode === 'experiment' ? exp?.modifiers : undefined;

  const filtered = useMemo(
    () => (chips.parameters ? filterParameters(params, { text, favoritesOnly: chips.favorites, favorites, componentName }) : []),
    [params, text, chips.parameters, chips.favorites, favorites, componentName],
  );
  const tabs: ParameterTab[] = useMemo(() => groupParameters(filtered), [filtered]);
  const tabNames = useMemo(() => [...tabs.map((t) => t.name), VARIABLES_TAB], [tabs]);
  const currentTab = tabNames.includes(subTab) ? subTab : tabNames[0];
  useEffect(() => {
    if (!tabNames.includes(subTab)) setSubTab(tabNames[0]);
  }, [tabNames, subTab]);

  const filterActive = text.trim() !== '' || chips.favorites || !chips.parameters || !chips.results;
  const toggleChip = (k: keyof Chips) => setChips((c) => ({ ...c, [k]: !c[k] }));

  const commitValue = (p: ParameterInfo, fullName: string, valueText: string | null) => {
    if (mode === 'experiment' && exp) {
      setModifier(exp.id, fullName, valueText);
      return;
    }
    void applyEdit({ op: 'setParameter', component: componentName, name: p.name, valueText });
  };
  const commitAttribute = (p: ParameterInfo, fullName: string, attr: AttributeName, valueText: string | null) => {
    if (mode === 'experiment' && exp) {
      setModifier(exp.id, `${fullName}.${attr}`, valueText);
      return;
    }
    void applyEdit({ op: 'setParameter', component: componentName, name: `${p.name}.${attr}`, valueText });
  };

  const variableRows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return variables
      .filter((v) => v.variability !== 'parameter' && v.variability !== 'constant')
      .map((v) => ({ name: fullVariableName(componentName, v.name), unit: v.unit, description: v.description }))
      .filter((v) => (!chips.favorites || favorites.includes(v.name)) && (!t || v.name.toLowerCase().includes(t) || (v.description?.toLowerCase().includes(t) ?? false)));
  }, [variables, componentName, text, chips.favorites, favorites]);

  const showResultsColumn = mode === 'results' && chips.results;
  const activeTab = tabs.find((t) => t.name === currentTab);

  return (
    <div className="properties-tab">
      <div className="details-filter-row">
        <button type="button" className={`chip${chips.parameters ? ' active' : ''}`} onClick={() => toggleChip('parameters')} aria-pressed={chips.parameters}>
          Parameters
        </button>
        <button type="button" className={`chip${chips.results ? ' active' : ''}`} onClick={() => toggleChip('results')} aria-pressed={chips.results}>
          Results
        </button>
        <button type="button" className={`chip${chips.favorites ? ' active' : ''}`} onClick={() => toggleChip('favorites')} aria-pressed={chips.favorites}>
          Favorites
        </button>
        <label className="details-filter-field">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter" aria-label="Filter parameters" onKeyDown={(e) => e.stopPropagation()} />
          <span className={`icon-button${filterActive ? ' active' : ''}`} aria-hidden>
            <Icon.FilterList />
          </span>
        </label>
      </div>

      <div className="details-subtabs" role="tablist">
        {tabNames.map((name) => (
          <button key={name} type="button" role="tab" className={`details-subtab${name === currentTab ? ' active' : ''}`} aria-selected={name === currentTab} onClick={() => setSubTab(name)}>
            {name}
          </button>
        ))}
      </div>

      {currentTab === VARIABLES_TAB ? (
        variableRows.length ? (
          <VariablesList variables={variableRows} />
        ) : (
          <div className="details-empty">{variables.length ? 'No variables match the filter.' : 'No variables.'}</div>
        )
      ) : !activeTab ? (
        <div className="details-empty">{params.length ? (chips.parameters ? 'No parameters match the filter.' : 'Parameters are hidden by the filter chips.') : 'No parameters.'}</div>
      ) : (
        <>
          {showResultsColumn && (
            <div className="param-results-header" aria-hidden>
              <span>Name</span>
              <span />
              <span>Value</span>
              <span>Result</span>
              <span>Unit</span>
            </div>
          )}
          {activeTab.groups.map((g) => {
            const key = `${activeTab.name}/${g.name}`;
            const isCollapsed = collapsed[key] === true;
            return (
              <div key={key} className="details-group">
                <button type="button" className={`details-group-header${isCollapsed ? ' collapsed' : ''}`} onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))} aria-expanded={!isCollapsed}>
                  <Icon.ExpandMore />
                  <span>{g.name}</span>
                  <span className="details-group-count">{g.params.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="details-group-body">
                    {g.params.map((p) => {
                      const fullName = fullVariableName(componentName, p.name);
                      const attributeValues = Object.fromEntries(ATTRIBUTE_NAMES.map((a) => [a, attributeValue(p, a, params, experimentModifiers, componentName)])) as Record<AttributeName, string | undefined>;
                      return (
                        <ParameterRow
                          key={p.name}
                          p={p}
                          fullName={fullName}
                          mode={mode}
                          readOnly={readOnly}
                          unit={unitLabel(showDisplayUnits ? (p.displayUnit ?? p.unit) : p.unit)}
                          favorite={favorites.includes(fullName)}
                          onToggleFavorite={() => toggleFavorite(activeClass, fullName)}
                          onSticky={() => addSticky(activeClass, { component: componentName ?? '', variable: fullName, dx: 0, dy: -14, pinned: false, editable: true })}
                          modifier={experimentModifiers?.[fullName]}
                          onCommit={(v) => commitValue(p, fullName, v)}
                          attributesActive={hasAttributeModifier(p, params, experimentModifiers, componentName)}
                          attributeValues={attributeValues}
                          onCommitAttribute={(attr, v) => commitAttribute(p, fullName, attr, v)}
                          showResults={chips.results}
                          resultValue={showResultsColumn ? valueAt(fullName) : undefined}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
