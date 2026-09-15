import { useState } from 'react';
import { effectiveVoice, getVoiceChoice, setVoiceChoice, speak, type VoiceChoice } from '../audio/tts';

// Girl / Boy voice, defaulting to the child's gender on the account ("Auto"). Tapping a choice says a short sample.
export function VoicePicker() {
  const [choice, setChoice] = useState<VoiceChoice>(getVoiceChoice);
  const options: [VoiceChoice, string][] = [['auto', `Auto (${effectiveVoice() === 'boy' ? 'boy' : 'girl'})`], ['girl', 'Girl'], ['boy', 'Boy']];
  return (
    <div className="flex gap-1.5">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => { setVoiceChoice(v); setChoice(v); speak('Hello, I am ready.'); }}
          className={`flex-1 rounded-xl py-2 text-xs font-bold transition active:scale-95 ${choice === v ? 'bg-[#94c1c2] text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          aria-pressed={choice === v}>{label}</button>
      ))}
    </div>
  );
}
