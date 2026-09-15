// The classic Material/Fluent "indeterminate progress ring": the whole ring
// spins at a constant rate while the visible arc grows and shrinks on an
// ease-in-out curve. That combination is what reads as "speeds up, slows
// down, speeds up" (like the Windows/Office spinners) rather than a plain
// constant-speed spin, while staying smooth and calm -- no flashing, no
// jerky motion.
export function Spinner({
  size = 112, color = '#94c1c2', track = '#e2e8f0', strokeWidth = 5,
}: { size?: number; color?: string; track?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 50 50" className="spinner-rotate motion-reduce:animate-none">
      <circle cx="25" cy="25" r="20" fill="none" stroke={track} strokeWidth={strokeWidth} />
      <circle
        cx="25" cy="25" r="20" fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round"
        className="spinner-dash motion-reduce:animate-none"
      />
    </svg>
  );
}
