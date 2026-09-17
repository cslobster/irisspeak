import { useLocation, useNavigate } from 'react-router-dom';
import { CloseIcon } from './Icons';
import { isSettingsPath, settingsReturnTo } from '../settingsNav';

// Rendered in the same fixed top-right row as SettingsButton, right next to it, so the two never
// overlap regardless of viewport size (unlike a close button placed inside each settings screen's
// own scrollable header, whose horizontal position shifts with the screen's max-width layout).
// Only shown while on a settings screen (Stars/Vocabulary/Profile/Credits); closes back to
// wherever the user was before opening settings, no matter how many settings screens they hopped
// through in between.
export function SettingsCloseButton() {
  const nav = useNavigate();
  const location = useLocation();
  if (!isSettingsPath(location.pathname)) return null;

  return (
    <button
      onClick={() => nav(settingsReturnTo(location), { replace: true })}
      className="h-12 w-12 rounded-2xl bg-white/80 backdrop-blur flex items-center justify-center hover:bg-white transition active:scale-95"
      style={{ boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 4 }}
      aria-label="Close settings"
    >
      <CloseIcon />
    </button>
  );
}
