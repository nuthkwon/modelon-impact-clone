/** Circular progress indicator (`.spinner`). Sizes: 'small' 16px, default 24px, 'large' 40px. */
import './common.css';

export function Spinner({ size, className, label }: { size?: 'small' | 'large'; className?: string; label?: string }) {
  return <span className={`spinner${size ? ` ${size}` : ''}${className ? ` ${className}` : ''}`} role="progressbar" aria-label={label ?? 'Loading'} />;
}

export default Spinner;
