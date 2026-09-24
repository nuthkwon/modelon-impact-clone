/** Application logo: a generic stylised "M" glyph on an orange rounded square (not Modelon's trademark). */
import './shell.css';

export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={`app-logo${className ? ` ${className}` : ''}`} style={{ width: size, height: size, flexBasis: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size}>
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M7 24V8l9 10 9-10v16" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default Logo;
