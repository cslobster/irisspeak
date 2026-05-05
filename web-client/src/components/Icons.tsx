// Inline SVG illustrations approximating the RN client's flat-style icons.

export function CalendarIcon({ size = 200 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      <rect x="20" y="36" width="160" height="140" rx="14" fill="#fff" stroke="#fff" strokeWidth="4"/>
      <rect x="20" y="36" width="160" height="36" rx="14" fill="#3b5bdb"/>
      <rect x="48" y="22" width="14" height="34" rx="6" fill="#1c2c5b"/>
      <rect x="138" y="22" width="14" height="34" rx="6" fill="#1c2c5b"/>
      {[0, 1, 2].map(r => [0, 1, 2, 3].map(c => (
        <rect key={`${r}-${c}`} x={36 + c * 35} y={84 + r * 26} width="22" height="20" rx="4" fill="#e9ecef"/>
      )))}
      <circle cx="100" cy="120" r="14" fill="#fcc419"/>
    </svg>
  );
}

export function HomeIcon({ size = 200 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      <path d="M40 96 L100 46 L160 96 V160 Q160 172 148 172 H52 Q40 172 40 160 Z" fill="#fff"/>
      <rect x="86" y="120" width="28" height="52" rx="4" fill="#74b86b"/>
      <rect x="56" y="108" width="22" height="20" rx="3" fill="#a5d8a3"/>
      <rect x="122" y="108" width="22" height="20" rx="3" fill="#a5d8a3"/>
      <path d="M30 102 L100 38 L170 102" stroke="#2b8a3e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

export function StarIcon({ size = 200, fill = '#ffd43b' }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      <path
        d="M100 14 L124 78 L192 86 L142 132 L156 198 L100 164 L44 198 L58 132 L8 86 L76 78 Z"
        fill={fill} stroke="#f59f00" strokeWidth="3" strokeLinejoin="round"
      />
    </svg>
  );
}

export function MenuIcon({ size = 24, color = '#575757' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M4 12h16M4 17h16" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

export function MicIcon({ size = 24, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="9" y="3" width="6" height="12" rx="3" fill={color}/>
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

export function StopIcon({ size = 24, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="6" y="6" width="12" height="12" rx="2" fill={color}/>
    </svg>
  );
}

export function CloseIcon({ size = 24, color = '#575757' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M5 5l14 14M19 5L5 19" stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}
