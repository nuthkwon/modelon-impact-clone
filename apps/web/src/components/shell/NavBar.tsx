/**
 * Navigation bar (§3). `home` renders the reduced variant used on the Home page.
 */
import { useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent } from 'react';
import { useStore } from '../../store';
import type { Mode, View } from '../../store/types';
import { AppsIcon, CodeIcon, DiagramIcon, ExpandMoreIcon, ExperimentIcon, HelpIcon, ResultsIcon, SettingsIcon } from '../icons';
import { MenuList } from '../common/ContextMenu';
import type { MenuItem } from '../common/ContextMenu';
import { Popover } from '../common/Popover';
import { Tooltip } from '../common/Tooltip';
import { Logo } from './Logo';
import { APP_NAME, APP_VERSION, useShellActions } from './shellActions';
import './shell.css';

export interface NavBarProps {
  navigate: (path: string) => void;
  /** Home-page variant: no workspace name, mode buttons or view toggle. */
  home?: boolean;
  /** Overrides the Apps → "Workspace Management" entry (Home page toggles its panel). */
  onWorkspaceManagement?: () => void;
}

type MenuKind = 'apps' | 'help' | 'user';

function shortName(name: string | undefined): string | undefined {
  return name?.split('.').pop();
}

export function NavBar({ navigate, home, onWorkspaceManagement }: NavBarProps) {
  const shell = useShellActions();
  const workspace = useStore((s) => s.workspace);
  const workspaceId = useStore((s) => s.workspaceId);
  const activeClass = useStore((s) => s.activeClass);
  const mode = useStore((s) => s.mode);
  const view = useStore((s) => s.view);
  const setMode = useStore((s) => s.setMode);
  const setView = useStore((s) => s.setView);
  const experimentName = useStore((s) => s.getActiveExperiment()?.name);
  const resultName = useStore((s) => s.getActiveResult()?.name);
  const [menu, setMenu] = useState<{ kind: MenuKind; anchor: HTMLElement } | null>(null);

  const toggleMenu = (kind: MenuKind) => (e: ReactMouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget;
    setMenu((m) => (m?.kind === kind ? null : { kind, anchor }));
  };
  const closeMenu = () => setMenu(null);

  // Grouped like Impact's Apps menu: uppercase group headers, external items carry an open-in-new icon.
  const appsItems: MenuItem[] = [
    { label: 'Workspace Management', header: true },
    { label: 'Workspace Configuration', onSelect: onWorkspaceManagement ?? (() => shell.openWorkspaceManagement()) },
    { label: 'General Apps', header: true },
    { label: 'Documentation', external: true, onSelect: () => shell.openDocs() },
    { label: 'Tools - Advanced', header: true },
    { label: 'Server Management', onSelect: () => shell.openAbout() },
  ];
  const helpItems: MenuItem[] = [
    { label: 'Documentation', onSelect: () => shell.openDocs() },
    { label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => shell.openShortcuts() },
    { label: 'Support', onSelect: () => shell.openSupport() },
    { separator: true },
    { label: 'About', onSelect: () => shell.openAbout() },
  ];
  const userItems: MenuItem[] = [{ label: 'User', header: true }, { label: 'Sign out', disabled: true, title: 'Not available in this clone' }];
  const menuWidth = menu?.kind === 'apps' ? 250 : 220;

  const modes: { mode: Mode; icon: JSX.Element; kind: string; label: string; tooltip: string }[] = [
    { mode: 'model', icon: <DiagramIcon />, kind: 'Model', label: shortName(activeClass) ?? 'Model', tooltip: 'Model mode (1)' },
    { mode: 'experiment', icon: <ExperimentIcon />, kind: 'Experiment', label: experimentName ?? 'Experiment', tooltip: 'Experiment mode (2)' },
    { mode: 'results', icon: <ResultsIcon />, kind: 'Results', label: resultName ?? 'Results', tooltip: 'Results mode (3)' },
  ];
  const views: { view: View; icon: JSX.Element; label: string; disabled?: boolean }[] = [
    { view: 'diagram', icon: <DiagramIcon />, label: 'Diagram view' },
    { view: 'code', icon: <CodeIcon />, label: activeClass ? 'Code view' : 'Code view (select a class first)', disabled: !activeClass },
  ];

  return (
    <header className="navbar" role="banner">
      <div className="navbar-left">
        <Tooltip text={`${APP_NAME} ${APP_VERSION}`}>
          <a
            className="navbar-logo"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            aria-label="Home"
          >
            <Logo />
            <span className="navbar-wordmark">IMPACT</span>
          </a>
        </Tooltip>
        {!home && workspace && (
          <Tooltip text={workspaceId ?? ''}>
            <span className="navbar-workspace">{workspace.definition.name}</span>
          </Tooltip>
        )}
      </div>

      {!home && (
        <nav className="navbar-center" aria-label="Mode">
          <div className="mode-group" role="tablist">
            {modes.map((m) => (
              <Tooltip key={m.mode} text={m.tooltip}>
                <button type="button" role="tab" aria-selected={mode === m.mode} className={`mode-button${mode === m.mode ? ' active' : ''}`} onClick={() => setMode(m.mode)}>
                  {m.icon}
                  {false && <span className="mode-kind">{m.kind}:</span>}
                  <span className="mode-label">{m.label}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        </nav>
      )}

      <div className="navbar-right">
        {!home && (
          <>
            <div className="view-toggle" role="group" aria-label="View">
              {views.map((v) => (
                <Tooltip key={v.view} text={v.label}>
                  <button
                    type="button"
                    className={`${view === v.view ? 'active' : ''}${v.disabled ? ' disabled' : ''}`}
                    aria-pressed={view === v.view}
                    aria-disabled={v.disabled || undefined}
                    aria-label={v.label}
                    onClick={() => !v.disabled && setView(v.view)}
                  >
                    {v.icon}
                  </button>
                </Tooltip>
              ))}
            </div>
            <span className="navbar-divider" role="separator" />
          </>
        )}
        <Tooltip text="Apps">
          <button type="button" className={`icon-button navbar-apps${menu?.kind === 'apps' ? ' open' : ''}`} aria-label="Apps" aria-haspopup="menu" onClick={toggleMenu('apps')}>
            <AppsIcon />
            <ExpandMoreIcon className="navbar-caret" />
          </button>
        </Tooltip>
        {!home && (
          <Tooltip text="Application settings">
            <button type="button" className="icon-button" aria-label="Application settings" onClick={() => shell.openSettings()}>
              <SettingsIcon />
            </button>
          </Tooltip>
        )}
        <span className="navbar-divider" role="separator" />
        <Tooltip text="Help">
          <button type="button" className={`icon-button${menu?.kind === 'help' ? ' open' : ''}`} aria-label="Help" aria-haspopup="menu" onClick={toggleMenu('help')}>
            <HelpIcon />
          </button>
        </Tooltip>
        <span className="navbar-divider" role="separator" />
        <Tooltip text="User">
          <button type="button" className={`icon-button avatar-button${menu?.kind === 'user' ? ' open' : ''}`} aria-label="User menu" aria-haspopup="menu" onClick={toggleMenu('user')}>
            <span className="avatar">U</span>
          </button>
        </Tooltip>
      </div>

      <Popover anchor={menu?.anchor} open={menu !== null} onClose={closeMenu} placement="bottom-end">
        {menu && <MenuList chrome={false} items={menu.kind === 'apps' ? appsItems : menu.kind === 'help' ? helpItems : userItems} onClose={closeMenu} style={{ minWidth: menuWidth, padding: '6px 0' }} />}
      </Popover>
    </header>
  );
}

export default NavBar;
