import { useState } from 'react';
import { getMuted, toggleMuted } from '../audio/mute';
import { SoundOffIcon, SoundOnIcon } from './Icons';

// Mounted once at the App level (see App.tsx) so it appears in the top-right
// on every screen, rather than being duplicated into each one individually.
export function MuteButton() {
  const [muted, setMuted] = useState(getMuted);

  return (
    <button
      onClick={() => setMuted(toggleMuted())}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      aria-pressed={muted}
      className="fixed top-5 right-20 z-40 w-12 h-12 rounded-2xl bg-white/80 backdrop-blur shadow border border-white/60 flex items-center justify-center hover:bg-white transition active:scale-95"
    >
      {muted ? <SoundOffIcon size={22} color="#6b7280" /> : <SoundOnIcon size={22} color="#6b7280" />}
    </button>
  );
}
