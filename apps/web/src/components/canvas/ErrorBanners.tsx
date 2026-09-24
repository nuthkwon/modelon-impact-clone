/**
 * Error/warning/info banners stacked at the top of the canvas (UI_SPEC §5.3). At most three
 * are shown, the rest collapse into "+N more".
 */
import { useState } from 'react';
import { useStore } from '../../store';
import { Icon } from '../icons';
import { useShellActions } from '../shell/shellActions';

const MAX_VISIBLE = 3;

export function ErrorBanners() {
  const banners = useStore((s) => s.banners);
  const dismissBanner = useStore((s) => s.dismissBanner);
  const showLog = useStore((s) => s.showLog);
  const shell = useShellActions();
  const [showAll, setShowAll] = useState(false);
  if (!banners.length) return null;
  const visible = showAll ? banners : banners.slice(0, MAX_VISIBLE);
  const hidden = banners.length - visible.length;
  return (
    <div className="canvas-banners" role="alert">
      {visible.map((b) => (
        <div key={b.id} className={`banner ${b.severity}`}>
          <span className="banner-icon" aria-hidden="true">
            {b.severity === 'error' ? <Icon.Error /> : b.severity === 'warning' ? <Icon.Warning /> : <Icon.Info />}
          </span>
          <span className="banner-message" title={b.message}>
            {b.message}
          </span>
          {b.loc && (
            <button className="banner-link" onClick={() => shell.openCodeAtLine(b.loc!.line)}>
              line {b.loc.line}
            </button>
          )}
          {b.log && (
            <button className="banner-link" onClick={() => showLog(b.log!, true)}>
              Show log
            </button>
          )}
          <button className="icon-button banner-close" title="Dismiss" aria-label="Dismiss" onClick={() => dismissBanner(b.id)}>
            <Icon.Close />
          </button>
        </div>
      ))}
      {hidden > 0 && (
        <button className="banner-more" onClick={() => setShowAll(true)}>
          +{hidden} more
        </button>
      )}
    </div>
  );
}
