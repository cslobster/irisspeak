import { useEffect, useState } from 'react';

// Zoom-to-fit: the session screen is laid out on a canvas of at least DESIGN_W x DESIGN_H CSS pixels
// (an iPad-sized board) and scaled down as a whole on smaller viewports such as an iPhone in landscape,
// so nothing overflows or needs scrolling. Larger viewports get scale 1 and the canvas simply grows.
// One width for the whole board, set by the fixed row: Yes / No / Please, five personal cards, More ideas and
// View all -- ten medium chips (96px) at the row gap (12px). Everything above and below the row takes this width.
export const CONTENT_W = 10 * 96 + 9 * 12;   // 1068
// iPad Safari in landscape with its tab bar showing is wide but short. Logical viewports (CSS px) with the address
// bar and tab bar visible: 11-inch iPad Air/Pro about 1180x720 (M4 11-inch 1210x734), 10th-gen 10.9-inch about
// 1080x700, iPad mini about 1133x640; the 13-inch is about 1366x920 and keeps the normal layout. In the short
// ones the action buttons (Refresh / Clear / Done / Feedback) stand in a column on the right of the board instead
// of a row under it, and the canvas is shorter, so the cards get the height back.
export const ACTION_COL_W = 112;   // one tile wide (sm:w-24 = 96px) plus breathing room
export const SIDE_DESIGN_H = 812;   // header + deck + panels + fixed row (measured 805 at scale 1), no action row
export function useShortLandscape() {
  // iPad-class: landscape, at least 1000 wide, not taller than 900 (an 11-inch iPad is 820 tall; with Safari's tab bar ~720)
  const calc = () => window.innerWidth >= 1000 && window.innerHeight <= 900 && window.innerWidth > window.innerHeight;
  const [v, setV] = useState(calc);
  useEffect(() => { const f = () => setV(calc()); window.addEventListener('resize', f); window.addEventListener('orientationchange', f); return () => { window.removeEventListener('resize', f); window.removeEventListener('orientationchange', f); }; }, []);
  return v;
}
export const DESIGN_W = CONTENT_W + 32, DESIGN_H = 880;
export function fitFor(vw: number, vh: number, dw = DESIGN_W, dh = DESIGN_H) {
  const s = Math.min(1, vw / dw, vh / dh);
  return { s, vw, vh, cw: vw / s, ch: vh / s, dw, dh };
}
// The size comes from the fixed full-viewport root element (measured with ResizeObserver), not from
// window.innerHeight, which iPad Safari misreports in full-screen mode and leaves a gap at the bottom.
export function useFitScale(rootRef: React.RefObject<HTMLDivElement>, dw = DESIGN_W, dh = DESIGN_H) {
  const [st, setSt] = useState(() => fitFor(window.innerWidth, window.innerHeight, dw, dh));
  useEffect(() => {
    const el = rootRef.current;
    const measure = () => {
      const r = el?.getBoundingClientRect();
      const vw = r && r.width > 0 ? r.width : window.innerWidth;
      const vh = r && r.height > 0 ? r.height : window.innerHeight;
      setSt(prev => (prev.vw === vw && prev.vh === vh && prev.dw === dw && prev.dh === dh) ? prev : fitFor(vw, vh, dw, dh));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(measure) : null;
    ro?.observe(el!);
    window.addEventListener('resize', measure); window.addEventListener('orientationchange', measure); window.visualViewport?.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('orientationchange', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [rootRef, dw, dh]);
  useEffect(() => {
    document.documentElement.style.setProperty('--fit-scale', String(st.s));
    return () => { document.documentElement.style.removeProperty('--fit-scale'); };
  }, [st.s]);
  return st;
}
