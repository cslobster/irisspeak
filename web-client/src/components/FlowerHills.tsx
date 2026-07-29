// Shared decorative flower-meadow hills backdrop, used by SignInScreen and
// WelcomeScreen. Extracted verbatim from both (previously copy-pasted
// identically in each file) — purely a dedup, markup/colors unchanged.
interface FlowerProps {
  x: number; y: number;
  color: string; stemColor?: string; size?: number;
}

function Flower({ x, y, color, stemColor = '#4ade80', size = 1 }: FlowerProps) {
  const r = 9 * size, d = 13 * size;
  const petals = [0, 72, 144, 216, 288].map(a => {
    const rad = (a * Math.PI) / 180;
    return { cx: Math.sin(rad) * d, cy: -Math.cos(rad) * d };
  });
  return (
    <g transform={`translate(${x},${y})`}>
      <line x1="0" y1="2" x2="0" y2={52 * size} stroke={stemColor} strokeWidth={3.5 * size} strokeLinecap="round" />
      {petals.map((p, i) => <circle key={i} cx={p.cx} cy={p.cy} r={r} fill={color} opacity="0.92" />)}
      <circle cx="0" cy="0" r={6 * size} fill="#fde047" />
    </g>
  );
}

export function FlowerHillsBackdrop() {
  return (
    <div className="absolute bottom-0 left-0 right-0" style={{ height: '42vh' }}>
      <svg
        viewBox="0 0 1440 380"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <ellipse cx="720" cy="520" rx="1100" ry="310" fill="#a7f3d0" opacity="0.5" />
        <ellipse cx="720" cy="560" rx="1200" ry="320" fill="#86efac" />
        <Flower x={90}  y={295} color="#f9a8d4" size={1.1} />
        <Flower x={195} y={268} color="#93c5fd" size={0.9} />
        <Flower x={310} y={252} color="#c4b5fd" size={1.0} />
        <Flower x={440} y={243} color="#f9a8d4" size={1.3} />
        <Flower x={570} y={238} color="#93c5fd" size={0.85} />
        <Flower x={680} y={236} color="#f9a8d4" size={1.0} />
        <Flower x={790} y={238} color="#c4b5fd" size={1.2} />
        <Flower x={910} y={242} color="#f9a8d4" size={0.9} />
        <Flower x={1030} y={252} color="#93c5fd" size={1.1} />
        <Flower x={1150} y={265} color="#f9a8d4" size={1.0} />
        <Flower x={1265} y={283} color="#c4b5fd" size={0.9} />
        <Flower x={1370} y={300} color="#f9a8d4" size={1.1} />
      </svg>
    </div>
  );
}
