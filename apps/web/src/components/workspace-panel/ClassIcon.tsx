/**
 * 18×18 class icon: the resolved Modelica `Icon` layer via `IconSvg`, or a restriction-specific
 * fallback glyph when the class has no graphics.
 */
import { memo } from 'react';
import type { ClassRestriction, GraphicsLayer } from '@impact/core';
import { IconSvg } from '../graphics/GraphicsLayerSvg';

export interface ClassIconProps {
  icon?: GraphicsLayer;
  restriction: ClassRestriction;
  size?: number;
  className?: string;
}

/** Fallback glyph per class restriction (20×20 viewBox, stroked with the current colour). */
export function FallbackGlyph({ restriction, size = 18, className }: { restriction: ClassRestriction; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 20 20', className: `wp-glyph wp-glyph-${restriction} ${className ?? ''}`.trim(), 'aria-hidden': true as const };
  const stroke = 'currentColor';
  switch (restriction) {
    case 'package':
      // MSL package look: rounded rectangle with a folder tab.
      return (
        <svg {...common}>
          <path d="M2.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l1.6 1.6H16a1.5 1.5 0 0 1 1.5 1.5v7.4a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" fill="var(--wp-glyph-fill)" stroke={stroke} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M2.5 9.2h15" stroke={stroke} strokeWidth="1" opacity="0.6" />
        </svg>
      );
    case 'model':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="14" height="14" rx="3" fill="var(--wp-glyph-fill)" stroke={stroke} strokeWidth="1.2" />
        </svg>
      );
    case 'block':
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="11" height="11" fill="var(--wp-glyph-fill)" stroke={stroke} strokeWidth="1.2" />
          <path d="M1 10h3.5M15.5 10H19" stroke={stroke} strokeWidth="1.2" />
        </svg>
      );
    case 'connector':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="8" height="8" fill={stroke} />
        </svg>
      );
    case 'record':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="14" height="12" rx="1" fill="var(--wp-glyph-fill)" stroke={stroke} strokeWidth="1.1" />
          <path d="M3 8h14M3 12h14M9.5 4v12" stroke={stroke} strokeWidth="1" />
        </svg>
      );
    case 'type':
      return (
        <svg {...common}>
          <text x="10" y="15" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="var(--font)" fill={stroke}>T</text>
        </svg>
      );
    case 'function':
      return (
        <svg {...common}>
          <text x="10" y="15" textAnchor="middle" fontSize="15" fontStyle="italic" fontFamily="Georgia, 'Times New Roman', serif" fill={stroke}>f</text>
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke={stroke} strokeWidth="1.1" strokeDasharray="2.5 1.5" />
        </svg>
      );
  }
}

export const ClassIcon = memo(function ClassIcon({ icon, restriction, size = 18, className }: ClassIconProps) {
  return (
    <span className={`wp-icon ${className ?? ''}`.trim()} style={{ width: size, height: size }}>
      <IconSvg icon={icon} size={size} fallback={<FallbackGlyph restriction={restriction} size={size} />} />
    </span>
  );
});
