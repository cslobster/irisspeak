import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GearIcon, SoundOffIcon, SoundOnIcon } from './Icons';
import { getMuted, toggleMuted } from '../audio/mute';
import { VoicePicker } from './VoicePicker';
import { UI_SCALE_LEVELS, UI_SCALE_LABELS, getUiScaleLevel, setUiScaleLevel, type UiScaleLevel } from '../uiScale';
import { isSignedIn, onAuthChange, signOut as remoteSignOut } from '../api/remote';
import { goToSettings } from '../settingsNav';

// Same Settings menu as irisspeak.com, mounted once at the App level inside the fixed top-right button row,
// so it appears in the same spot on every authenticated screen.
export function SettingsButton() {
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [uiScale, setUiScale] = useState<UiScaleLevel>(getUiScaleLevel);
  const [muted, setMuted] = useState(getMuted);
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(x => x + 1); onAuthChange.add(f); return () => { onAuthChange.delete(f); }; }, []);

  if (!isSignedIn()) return null;

  function signOut() {
    remoteSignOut();
    setOpen(false);
    nav('/', { replace: true });
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <div className="relative z-50">
        <button
          onClick={() => setOpen(o => !o)}
          className="h-12 pl-3 pr-4 rounded-2xl bg-white/80 backdrop-blur flex items-center gap-2 hover:bg-white transition active:scale-95"
          style={{ boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 4 }}
          aria-label="Settings"
        >
          <GearIcon size={20} color="#6b7280" />
          <span className="text-sm font-bold text-slate-600 whitespace-nowrap">Settings</span>
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <button
              onClick={() => setMuted(toggleMuted())}
              className="w-full text-left px-5 py-4 text-sm font-bold text-slate-600 hover:bg-slate-50 transition border-b border-slate-100 flex items-center gap-3"
              aria-pressed={muted}
            >
              {muted ? <SoundOffIcon size={20} color="#f09281" /> : <SoundOnIcon size={20} color="#6b7280" />}
              <span className={muted ? 'text-[#f09281]' : ''}>{muted ? 'Sound off' : 'Sound on'}</span>
            </button>
            <div className="px-5 pt-4 pb-3 border-b border-slate-100">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 mb-2">Voice</p>
              <VoicePicker />
            </div>
            <div className="px-5 pt-4 pb-3 border-b border-slate-100">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 mb-2">
                Text &amp; card size
              </p>
              <div className="flex gap-1.5">
                {UI_SCALE_LEVELS.map(level => (
                  <button
                    key={level}
                    onClick={() => { setUiScaleLevel(level); setUiScale(level); }}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition active:scale-95 ${
                      uiScale === level
                        ? 'bg-[#94c1c2] text-white shadow'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    aria-pressed={uiScale === level}
                  >
                    {UI_SCALE_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => { setOpen(false); goToSettings(nav, location, '/stars'); }}
              className="w-full text-left px-5 py-4 text-sm font-bold text-slate-600 hover:bg-slate-50 transition border-b border-slate-100"
            >
              Previous conversations
            </button>
            <button
              onClick={() => { setOpen(false); goToSettings(nav, location, '/vocabulary'); }}
              className="w-full text-left px-5 py-4 text-sm font-bold text-slate-600 hover:bg-slate-50 transition border-b border-slate-100"
            >
              Vocabulary
            </button>
            <button
              onClick={() => { setOpen(false); goToSettings(nav, location, '/profile'); }}
              className="w-full text-left px-5 py-4 text-sm font-bold text-slate-600 hover:bg-slate-50 transition border-b border-slate-100"
            >
              Profile
            </button>
            <button
              onClick={() => { setOpen(false); goToSettings(nav, location, '/credits'); }}
              className="w-full text-left px-5 py-4 text-sm font-bold text-slate-600 hover:bg-slate-50 transition border-b border-slate-100"
            >
              Credits &amp; privacy
            </button>
            <button
              onClick={signOut}
              className="w-full text-left px-5 py-4 text-sm font-bold text-[#f09281] hover:bg-[#f09281]/10 transition"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </>
  );
}
