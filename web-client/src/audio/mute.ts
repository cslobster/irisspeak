// Global sound-mute toggle. Persisted like the uiScale setting (see ../uiScale.ts).

const STORAGE_KEY = 'aacesstalk:muted';

export function getMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {}
  // Stop anything already playing the instant it's muted.
  if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function toggleMuted(): boolean {
  const next = !getMuted();
  setMuted(next);
  return next;
}
