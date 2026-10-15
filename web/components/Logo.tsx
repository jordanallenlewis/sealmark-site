import { LOGO, RING_GAP } from "@/lib/logo";

export function Logo({ size = 30, className }: { size?: number; className?: string }) {
  const c = LOGO.center;
  const box = "0 0 " + LOGO.viewBox + " " + LOGO.viewBox;
  return (
    <svg viewBox={box} aria-hidden="true" focusable="false" className={className} style={className ? undefined : { width: size, height: size }}>
      <circle className="lg-ring" cx={c} cy={c} r={LOGO.ring.r} strokeWidth={LOGO.ring.width} strokeDasharray={LOGO.ring.dash + " " + RING_GAP} transform={"rotate(-90 " + c + " " + c + ")"} />
      <circle className="lg-disc" cx={c} cy={c} r={LOGO.disc.r} />
      {LOGO.rows.ys.map((y, i) => (
        <line key={y} className={i === LOGO.rows.dimIndex ? "lg-dim" : "lg-row"} x1={LOGO.rows.x1} y1={y} x2={LOGO.rows.x2} y2={y} strokeWidth={LOGO.rows.width} />
      ))}
    </svg>
  );
}
