/** Single small spinning piece for inline/tight spots (e.g. next to a status
 * label). The app's main loading states use a plain ring spinner instead. */
export function PuzzleLoaderSmall({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className="puzzle-spin motion-reduce:animate-none"
      style={{ transformOrigin: '50% 50%', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.28))' }}
    >
      <g transform="translate(24 24) translate(-15 -15)">
        <g className="puzzle-piece motion-reduce:animate-none" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
          <path
            d="M0,0 L30,0 L30,10 Q38,10 38,15 Q38,20 30,20 L30,30 L20,30 Q15,23 10,30 L0,30 Z"
            fill="#94c1c2"
            stroke="#000"
            strokeWidth={4}
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}
