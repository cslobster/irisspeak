import { useState } from 'react';
import { getMuted, toggleMuted } from '../audio/mute';
import { SoundOffIcon, SoundOnIcon } from './Icons';

// Mounted once at the App level (see App.tsx), inside the fixed top-right
// button row, so it appears on every screen rather than being duplicated.
export function MuteButton() {
  const [muted, setMuted] = useState(getMuted);

  return (
    <button
      onClick={() => setMuted(toggleMuted())}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      aria-pressed={muted}
      className="h-12 pl-3 pr-4 rounded-2xl bg-white/80 backdrop-blur flex items-center gap-2 hover:bg-white transition active:scale-95"
      style={{ boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 4 }}
    >
      {muted ? <SoundOffIcon size={20} color="#f09281" /> : <SoundOnIcon size={20} color="#6b7280" />}
      <span className={`text-sm font-bold whitespace-nowrap ${muted ? 'text-[#f09281]' : 'text-slate-600'}`}>{muted ? 'Muted' : 'Sound'}</span>
    </button>
  );
}
