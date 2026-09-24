/** Material-style toggle switch row: `<Switch checked onChange label sub disabled/>`. */
import type { ReactNode } from 'react';
import './common.css';

export function Switch({ checked, onChange, label, sub, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode; disabled?: boolean; id?: string }) {
  return (
    <div className="switch-row">
      <span className="switch-label">
        <span>{label}</span>
        {sub && <span className="switch-sub">{sub}</span>}
      </span>
      <button id={id} type="button" role="switch" aria-checked={checked} className={`switch${checked ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} />
    </div>
  );
}

export default Switch;
