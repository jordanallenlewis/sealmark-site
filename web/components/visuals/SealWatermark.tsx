// Page-wide watermark: the Logo geometry (dashed ring, disc outline, three rows) at ~1,400px,
// drawn in --wm (about 4% gold). Static: no parallax, no animation. Styles live in globals.css (.sealwm).
export function SealWatermark() {
  const line = { stroke: "var(--wm)", fill: "none", vectorEffect: "non-scaling-stroke" } as const;
  return (
    <div className="sealwm" aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <circle cx="16" cy="16" r="14" {...line} strokeWidth={10} strokeDasharray="24 18" />
        <circle cx="16" cy="16" r="10.5" {...line} strokeWidth={10} />
        <line x1="11" y1="12.5" x2="21" y2="12.5" {...line} strokeWidth={30} strokeLinecap="round" />
        <line x1="11" y1="16" x2="21" y2="16" {...line} strokeWidth={30} strokeLinecap="round" opacity={0.5} />
        <line x1="11" y1="19.5" x2="21" y2="19.5" {...line} strokeWidth={30} strokeLinecap="round" />
      </svg>
    </div>
  );
}
