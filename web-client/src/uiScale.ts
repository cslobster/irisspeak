// Accessibility text/card-size setting.
//
// Free pinch-to-zoom is intentionally disabled app-wide (see index.html's
// `user-scalable=no`) because this app has a hard "no scrolling, ever"
// constraint -- letting people zoom freely could push content past the
// viewport. This is the controlled replacement: a small number of discrete,
// pre-tested size steps that are guaranteed to still fit the iPad viewport.
//
// The chosen level is persisted to localStorage (same mechanism already used
// for the JWT / child name, see src/store/index.ts) and applied globally via
// a `ui-scale-*` class on <html>, which styles.css turns into a `--ui-scale`
// CSS variable that the relevant Tailwind-styled elements key off of.

export type UiScaleLevel = 'normal' | 'large' | 'xl';

const STORAGE_KEY = 'irisspeak:uiScale';

export const UI_SCALE_LEVELS: UiScaleLevel[] = ['normal', 'large', 'xl'];

export const UI_SCALE_LABELS: Record<UiScaleLevel, string> = {
  normal: 'Normal',
  large: 'Large',
  xl: 'Extra Large',
};

function isUiScaleLevel(v: string | null): v is UiScaleLevel {
  return v === 'normal' || v === 'large' || v === 'xl';
}

export function getUiScaleLevel(): UiScaleLevel {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isUiScaleLevel(v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}

function applyUiScaleLevel(level: UiScaleLevel) {
  const root = document.documentElement;
  root.classList.remove('ui-scale-large', 'ui-scale-xl');
  if (level === 'large') root.classList.add('ui-scale-large');
  if (level === 'xl') root.classList.add('ui-scale-xl');
}

// Call once at app startup so the persisted level is applied before first paint.
export function initUiScale() {
  applyUiScaleLevel(getUiScaleLevel());
}

export function setUiScaleLevel(level: UiScaleLevel) {
  try { localStorage.setItem(STORAGE_KEY, level); } catch {}
  applyUiScaleLevel(level);
}
