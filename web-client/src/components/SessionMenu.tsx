import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloseIcon, SoundOffIcon, SoundOnIcon } from './Icons';
import { getMuted, toggleMuted } from '../audio/mute';
import { VoicePicker } from './VoicePicker';
import { UI_SCALE_LEVELS, UI_SCALE_LABELS, getUiScaleLevel, setUiScaleLevel, type UiScaleLevel } from '../uiScale';

export interface SettingOption { value: string; label: string; icon: string }

interface Props {
  onClose: () => void;
  onTranscript: () => void;
  setting: string; settings: SettingOption[]; onSettingChange: (v: string) => void;
  onEnd: () => void;
}

// The one session menu (opened from the ☰ button on every layout): Transcript, Sound, place,
// text size, previous conversations, profile and End conversation.
export function SessionMenu({ onClose, onTranscript, setting, settings, onSettingChange, onEnd }: Props) {
  const nav = useNavigate();
  const [muted, setMuted] = useState(getMuted);
  const [uiScale, setUiScale] = useState<UiScaleLevel>(getUiScaleLevel);
  const cur = settings.find(s => s.value === setting) ?? settings[0];

  return (
    <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 flex flex-col gap-3"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))', border: '2px solid #000', borderBottomWidth: 5 }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Menu</h2>
          <button onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <SheetButton label="Transcript" onClick={() => { onClose(); onTranscript(); }}><span className="text-2xl leading-none">📜</span></SheetButton>
          <SheetButton label={muted ? 'Muted' : 'Sound on'} onClick={() => setMuted(toggleMuted())} accent={muted}>
            {muted ? <SoundOffIcon size={26} color="#f09281" /> : <SoundOnIcon size={26} color="#6b7280" />}
          </SheetButton>
          <label className="relative flex flex-col items-center justify-center gap-1 py-2 rounded-xl bg-slate-100 cursor-pointer">
            <span className="text-2xl leading-none" aria-hidden="true">{cur.icon}</span>
            <span className="text-[11px] font-bold text-slate-600 leading-none">{cur.label.split(' /')[0]}</span>
            <select
              value={setting}
              onChange={e => onSettingChange(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              aria-label="Where are you talking?"
            >
              {settings.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Voice</p>
        <VoicePicker />
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">Text &amp; card size</p>
        <div className="flex gap-1.5">
          {UI_SCALE_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => { setUiScaleLevel(level); setUiScale(level); }}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition active:scale-95 ${uiScale === level ? 'bg-[#94c1c2] text-white shadow' : 'bg-slate-100 text-slate-600'}`}
              aria-pressed={uiScale === level}
            >{UI_SCALE_LABELS[level]}</button>
          ))}
        </div>
        <button onClick={() => nav('/stars')} className="w-full text-left py-3 text-sm font-bold text-slate-600 border-t border-slate-100">Previous conversations</button>
        <button onClick={() => nav('/profile')} className="w-full text-left py-3 text-sm font-bold text-slate-600 border-t border-slate-100">Profile</button>
        <button onClick={() => { onClose(); onEnd(); }} className="pill-btn bg-[#94c1c2] w-full text-sm py-2">End conversation</button>
      </div>
    </div>
  );
}

function SheetButton({ label, onClick, children, accent = false }: { label: string; onClick: () => void; children: React.ReactNode; accent?: boolean }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-1 py-2 rounded-xl bg-slate-100 active:scale-95 transition-transform">
      {children}
      <span className={`text-[11px] font-bold leading-none ${accent ? 'text-[#f09281]' : 'text-slate-600'}`}>{label}</span>
    </button>
  );
}
