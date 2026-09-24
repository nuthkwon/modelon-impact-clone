/** Lightweight fixed-position tooltip used for port hovers on the canvas. */
export interface TooltipState {
  x: number;
  y: number;
  text: string;
}

export function CanvasTooltip({ tip }: { tip?: TooltipState }) {
  if (!tip) return null;
  return (
    <div className="tooltip canvas-tooltip" style={{ left: tip.x + 12, top: tip.y + 16 }} role="tooltip">
      {tip.text}
    </div>
  );
}
