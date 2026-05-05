// Inline SVG approximation of the AACessTalk wordmark.
export function Logo({ width = 360, height = 130 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 360 130" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f9aa33"/>
          <stop offset="1" stopColor="#f57f17"/>
        </linearGradient>
      </defs>
      <text x="180" y="75" textAnchor="middle" fontFamily="Nunito, sans-serif" fontWeight="800" fontSize="56" fill="url(#g1)">
        AACessTalk
      </text>
      <text x="180" y="106" textAnchor="middle" fontFamily="Nunito, sans-serif" fontWeight="600" fontSize="14" fill="#666">
        Cards · Conversation · Care
      </text>
    </svg>
  );
}
