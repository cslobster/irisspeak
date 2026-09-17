import type { Location, NavigateFunction } from 'react-router-dom';

// Screens opened from the Settings button / session menu. Only one of these is ever open at a
// time: hopping between them replaces the current history entry instead of stacking a new one,
// and each screen's close button returns to wherever the user actually came from (home, a
// session, etc.) rather than walking back through every settings screen visited in between.
export const SETTINGS_PATHS = ['/stars', '/vocabulary', '/profile', '/credits'];

export function isSettingsPath(pathname: string): boolean {
  return SETTINGS_PATHS.includes(pathname);
}

interface ReturnToState {
  returnTo?: string;
}

// Where "close" on the settings screen we're about to land on should go: the place the user was
// before entering settings, carried forward across any number of settings screens.
export function settingsReturnTo(location: Pick<Location, 'pathname' | 'state'>): string {
  if (isSettingsPath(location.pathname)) {
    const state = location.state as ReturnToState | null;
    return state?.returnTo || '/home';
  }
  return location.pathname;
}

// Navigate to a settings screen from anywhere (the Settings button, the in-session menu, or
// another settings screen), preserving a single shared "where to close back to" target.
export function goToSettings(nav: NavigateFunction, location: Pick<Location, 'pathname' | 'state'>, path: string): void {
  nav(path, { replace: isSettingsPath(location.pathname), state: { returnTo: settingsReturnTo(location) } });
}
