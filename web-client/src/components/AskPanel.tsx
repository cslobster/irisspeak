import { useEffect, useState } from 'react';
import { MicIcon } from './Icons';
import { SETTINGS } from '../engine/settings';
import { store } from '../engine/store';

// The parent's turn, one screen: pick a place, tap one of its top 5 real questions (ranked by how often
// each was actually asked in the AAC training material -- see docs/QUESTION-BANK.md), or type / speak your
// own. No categories, no drill-down -- everything is visible at once.

interface QItem { q: string; n: number }
interface QBank { settings: Record<string, QItem[]> }
let bankCache: Promise<Record<string, QItem[]>> | null = null;
function loadBank(): Promise<Record<string, QItem[]>> {
  if (!bankCache) bankCache = fetch('/questions.json', { cache: 'no-cache' }).then(r => r.json()).then((d: QBank) => d.settings).catch(() => ({}));
  return bankCache;
}

interface Props {
  setting: string; onSettingChange: (v: string) => void;
  onAsk: (text: string) => void;
  parentMessage: string; setParentMessage: (s: string) => void; onSubmit: () => void;
  isRecording: boolean; partialTranscript: string; onMicTap: () => void;
  compact?: boolean;
  leading?: React.ReactNode;
}

export function AskPanel(p: Props) {
  const [bank, setBank] = useState<Record<string, QItem[]>>({});
  useEffect(() => { loadBank().then(setBank); }, []);
  const questions = bank[p.setting] ?? [];
  const displayValue = p.isRecording ? p.partialTranscript : p.parentMessage;
  const canSend = !!(p.parentMessage.trim() || (p.isRecording && p.partialTranscript.trim()));
  const c = !!p.compact;
  const mic = c ? 84 : 136;
  const tileStyle = (on = false) => ({ background: on ? '#94c1c2' : '#fff', boxSizing: 'border-box' as const, border: '2px solid #000', borderBottomWidth: on ? 2 : 4, transform: on ? 'translateY(2px)' : undefined });

  return (
    <div className={`w-full h-full flex flex-col ${c ? 'gap-2' : 'gap-3'} mx-auto min-h-0`}>
      {/* Step 1: the place. Sits on its own at the top. */}
      <div className="flex-shrink-0">
        <p className={`font-extrabold uppercase tracking-widest text-slate-400 mb-1.5 ${c ? 'text-[10px]' : 'text-xs'}`}>1 · Where are you?</p>
        <div className={`grid gap-2 sm:gap-3 ${c ? 'grid-cols-4' : 'grid-cols-8'}`}>
          {SETTINGS.map(s => {
            const on = s.value === p.setting;
            return (
              <button
                key={s.value}
                onClick={() => p.onSettingChange(s.value)}
                aria-pressed={on}
                title={s.label}
                className={`flex flex-col items-center justify-center rounded-xl active:scale-95 transition-transform ${c ? 'h-[64px] gap-0.5' : 'h-[88px] gap-1'}`}
                style={tileStyle(on)}
              >
                <span className={c ? 'text-3xl leading-none' : 'text-4xl leading-none'} aria-hidden="true">{s.icon}</span>
                <span
                  className={`font-bold leading-tight text-center whitespace-nowrap ${on ? 'text-white' : 'text-slate-500'}`}
                  style={{ fontSize: Math.max(c ? 7 : 9, (c ? 9 : 12) - Math.max(0, s.short.length - 4) * (c ? 0.35 : 0.45)) }}
                >{s.short}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={c ? 'h-1' : 'h-3'} />

      {/* Step 2: the question, one block: the top questions for this place, or speak, or type. */}
      <div className={`flex-shrink-0 rounded-2xl bg-white/60 ${c ? 'p-2' : 'p-5'}`} style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}>
        <p className={`font-extrabold uppercase tracking-widest text-slate-400 ${c ? 'text-[10px] mb-1.5' : 'text-sm mb-3'}`}>2 · Ask a question: pick one, or tap to speak, or type</p>
        {questions.length === 0 ? (
          <p className="text-xs text-slate-400 italic p-1">No questions yet for this place. Speak or type below.</p>
        ) : (
          <div className={`grid ${c ? 'gap-1.5 grid-cols-1' : 'gap-3 grid-cols-3'}`}>
            {questions.map(item => (
              <button
                key={item.q}
                onClick={() => p.onAsk(item.q)}
                className={`rounded-xl bg-white font-bold text-slate-700 text-left active:scale-95 transition-transform ${c ? 'px-3 py-2 text-sm min-h-[36px]' : 'px-4 py-3 text-lg min-h-[72px]'}`}
                style={{ boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 3 }}
              >{item.q}</button>
            ))}
          </div>
        )}
        <div className={`flex items-center gap-3 ${c ? 'my-3' : 'my-10'}`}>
          <div className="flex-1 border-t-2 border-dashed border-slate-300" />
          <span className={`font-bold text-slate-400 ${c ? 'text-[11px]' : 'text-sm'}`}>or</span>
          <div className="flex-1 border-t-2 border-dashed border-slate-300" />
        </div>
        {/* The big mic as before: centred, with its caption, then the text box */}
        <div className="flex flex-col items-center">
          <div className="relative flex items-center justify-center" style={{ width: mic + 16, height: mic + 16 }}>
            {p.isRecording && <span className="absolute inset-0 rounded-full mic-ripple" style={{ color: '#f09281' }} />}
            <button
              onClick={p.onMicTap}
              aria-label={p.isRecording ? 'Stop recording' : 'Start recording'}
              className={`relative z-10 flex items-center justify-center active:scale-95 transition-transform ${p.isRecording ? 'mic-breathe' : ''}`}
              style={{ width: mic, height: mic, borderRadius: '50%', background: p.isRecording ? '#f09281' : '#94c1c2', boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 7 }}
            >
              {p.isRecording ? <div className={`${c ? 'w-7 h-7' : 'w-10 h-10'} rounded-lg bg-white`} /> : <MicIcon size={mic * 0.5} color="#fff" />}
            </button>
          </div>
          <p className={`font-bold text-slate-500 select-none ${c ? 'text-xs mt-1 mb-2' : 'text-base mt-1 mb-4'}`}>{p.isRecording ? 'Listening… tap to stop' : 'Tap to speak, or type'}</p>
          <div className="flex items-center gap-3 w-full">
            {p.leading}
            <textarea
              className={`flex-1 min-w-0 bg-white rounded-2xl border-2 border-slate-200 focus:border-[#f09281] focus:outline-none font-medium text-slate-700 resize-none placeholder-slate-300 ${c ? 'px-3 py-2 text-base' : 'px-5 py-4 text-xl'}`}
              style={{ height: c ? 48 : 72 }}
              placeholder={p.isRecording ? 'Listening… tap the mic to stop' : 'Type your question…'}
              value={displayValue}
              readOnly={p.isRecording}
              onChange={e => { if (!p.isRecording) p.setParentMessage(e.target.value); }}
            />
            <button onClick={p.onSubmit} disabled={!canSend} className={`pill-btn bg-[#94c1c2] disabled:bg-slate-300 ${c ? 'text-sm px-3' : 'text-xl px-8'}`} style={{ minHeight: c ? 48 : 72 }}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
