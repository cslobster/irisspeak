import { useState } from 'react';
import { engine } from '../../engine/model';
import { FORM_LABELS, formsFor, inflect, type WordForm } from '../../engine/grammar';
import type { CardInfo } from '../../api/types';

/** The partner's verdict on this board: no card fits, or the answer the child wanted. Stored as training material. */
export function FeedbackDialog({ setting, question, candidates, onClose, onSend }: {
  setting: string; question: string; candidates: { id: string; label: string; category: string; personal?: boolean }[];
  onClose: () => void; onSend: (choice: 'dislike' | 'own_answer', answer: string, disliked: string[]) => Promise<'sent' | 'queued'>;
}) {
  const [choice, setChoice] = useState<'dislike' | 'own_answer'>('own_answer');
  const [answer, setAnswer] = useState('');
  const [disliked, setDisliked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'queued'>('idle');
  const canSend = state === 'idle' && (choice === 'dislike' ? disliked.size > 0 : answer.trim().length > 0);
  const send = async () => { setState('sending'); const r = await onSend(choice, answer.trim(), [...disliked]); setState(r); setTimeout(onClose, 1200); };
  const toggle = (id: string) => { setChoice('dislike'); setDisliked(d => { const n = new Set(d); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const shown = candidates.filter(c => c.category !== 'core' || c.personal);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-6" onClick={onClose}>
      <div className="bg-[#f7f3ea] rounded-3xl p-6 sm:p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl" style={{ border: '3px solid #000', borderBottomWidth: 6 }} onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-700 mb-3">Feedback</h2>
        <p className="text-sm sm:text-base text-slate-600 mb-1"><span className="font-bold">Setting:</span> {setting}</p>
        <p className="text-sm sm:text-base text-slate-600 mb-3"><span className="font-bold">Question:</span> “{question || '(nothing asked yet)'}”</p>
        <p className="text-sm font-bold text-slate-600 mb-1">Cards shown <span className="font-normal">(tap the cross to mark a card you don't like)</span>:</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {shown.map(c => {
            const off = disliked.has(c.id);
            return (
              <span key={c.id} className={`relative pl-2 pr-6 py-1 rounded-xl text-xs font-bold border-2 ${off ? 'bg-red-50 border-red-400 text-red-700 line-through' : c.personal ? 'bg-pink-100 border-pink-300 text-slate-700' : 'bg-white border-slate-300 text-slate-700'}`}>
                {c.label}
                <button type="button" onClick={() => toggle(c.id)} aria-label={off ? `Keep ${c.label}` : `Dislike ${c.label}`} title={off ? 'Keep' : "I don't like this card"}
                  className={`absolute -top-2 -right-2 w-5 h-5 rounded-full border-2 text-[11px] leading-none flex items-center justify-center ${off ? 'bg-red-500 border-red-600 text-white' : 'bg-white border-slate-400 text-slate-500'}`}>✕</button>
              </span>
            );
          })}
        </div>
        <label className="flex items-start gap-3 mb-2 cursor-pointer">
          <input type="radio" name="fb" checked={choice === 'dislike'} onChange={() => setChoice('dislike')} className="mt-1" />
          <span className="font-bold text-slate-700">1. I don't like the answer cards <span className="font-normal text-slate-500">({disliked.size} crossed out)</span></span>
        </label>
        <label className="flex items-start gap-3 mb-2 cursor-pointer">
          <input type="radio" name="fb" checked={choice === 'own_answer'} onChange={() => setChoice('own_answer')} className="mt-1" />
          <span className="font-bold text-slate-700">2. I want to give the answer</span>
        </label>
        {choice === 'own_answer' && (
          <textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={2} placeholder="What should the child have been able to say?"
                    className="w-full rounded-xl border-2 border-slate-300 p-3 text-base mb-3 bg-white" autoFocus />
        )}
        <div className="flex justify-end gap-3 mt-2">
          <button onClick={onClose} className="pill-btn bg-white text-slate-600 border-2 border-slate-400 text-sm sm:text-base px-5 py-2">Cancel</button>
          <button onClick={send} disabled={!canSend} className="pill-btn bg-[#9cc3bf] disabled:opacity-40 text-sm sm:text-base px-6 py-2">
            {state === 'sent' ? 'Thank you!' : state === 'queued' ? 'Saved, will send later' : state === 'sending' ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SentenceAcceptance({ sentence, onAccept, onReject, onAnother, busy }: { sentence: string; onAccept: () => void; onReject: () => void; onAnother: () => void; busy: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-6">
      <div
        className="w-full max-w-2xl rounded-[2rem] sm:rounded-[2.5rem] flex flex-col items-center gap-4 sm:gap-8 px-5 py-6 sm:px-8 sm:py-12 shadow-2xl overflow-y-auto"
        style={{ background: '#f0ebe1', boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8, maxHeight: '90dvh' }}
      >
        <h2 className="text-2xl sm:text-5xl font-extrabold text-slate-700">You said</h2>

        <div className="w-full max-w-xl rounded-3xl p-4 sm:p-8 bg-[#94c1c2]/10 overflow-y-auto" style={{ maxHeight: '40vh', opacity: busy ? 0.5 : 1 }}>
          <p className="text-xl sm:text-4xl font-bold text-slate-700 text-center leading-snug">{sentence}</p>
        </div>

        {/* "Another": a different wording from the on-device realiser. "Yes" speaks whichever one is showing. */}
        <button
          onClick={onAnother}
          disabled={busy}
          className="flex flex-col items-center gap-3 active:scale-95 motion-reduce:active:scale-100 transition-transform duration-300 ease-in-out disabled:opacity-60"
          aria-label="Try another sentence"
        >
          <div
            className="w-16 h-16 sm:w-28 sm:h-28 rounded-full flex items-center justify-center transition-colors duration-300 ease-in-out"
            style={{ background: busy ? '#f4a998' : '#f09281', boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 7 }}
          >
            <span className={`text-4xl sm:text-6xl text-white ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`}>↻</span>
          </div>
          <span className="text-xl font-bold text-slate-500 select-none">{busy ? 'Thinking…' : 'Another'}</span>
        </button>

        <div className="flex gap-4 w-full max-w-xl">
          <button
            onClick={onReject}
            className="flex-1 py-3 sm:py-6 rounded-3xl text-xl sm:text-3xl font-extrabold text-black active:brightness-95 transition-colors duration-300 ease-in-out"
            style={{ background: '#f09281', boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 6 }}
          >No</button>
          <button
            onClick={onAccept}
            disabled={busy}
            className="flex-1 py-3 sm:py-6 rounded-3xl text-xl sm:text-3xl font-extrabold text-black active:brightness-95 transition-colors duration-300 ease-in-out disabled:opacity-60"
            style={{ background: '#94c1c2', boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 6 }}
          >Yes</button>
        </div>
      </div>
    </div>
  );
}


/** Word forms for a held card: one button per form, showing the word it will add. */
export function WordFormsPopover({ card, onPick, onClose }: { card: CardInfo; onPick: (f: WordForm) => void; onClose: () => void }) {
  const base = card.corpus_name ?? card.label; const v = engine.byId[card.id];
  const forms = (v ? formsFor(v.category) : []).map(f => [f, inflect(base, f)] as const).filter(([, w]) => !!w);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-3xl p-5 shadow-2xl flex flex-col gap-3 min-w-[280px]" style={{ border: '3px solid #000', borderBottomWidth: 7 }} onClick={e => e.stopPropagation()}>
        <p className="text-center font-extrabold text-slate-700 text-lg">{base}</p>
        {forms.map(([f, w]) => (
          <button key={f} onClick={() => onPick(f)} className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-[#fdf1cf] active:scale-95 transition-transform" style={{ border: '2px solid #000', borderBottomWidth: 4 }}>
            <span className="text-sm font-bold text-slate-500">{FORM_LABELS[f]}</span>
            <span className="text-xl font-extrabold text-slate-800">{w}</span>
          </button>
        ))}
        <button onClick={onClose} className="pill-btn bg-slate-300 text-sm py-2 mt-1">Cancel</button>
      </div>
    </div>
  );
}
