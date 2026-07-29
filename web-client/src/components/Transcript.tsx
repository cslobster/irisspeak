import { useState } from 'react';
import type { DialogueMessage } from '../api/types';

interface Props {
  dialogue: DialogueMessage[];
  msgClassName?: string;
  roleClassName?: string;
  chipClassName?: string;
}

// Parent = app teal, child = app coral -- same accent colors used everywhere
// else (TurnBanner, buttons), consistent across every transcript view
// (live session panel, past-session history, end-of-session summary).
const ROLE_STYLE: Record<string, { border: string; label: string }> = {
  parent: { border: 'bg-[#94c1c2]/10 border-[#94c1c2]', label: 'text-[#94c1c2]' },
  child: { border: 'bg-[#f09281]/10 border-[#f09281]', label: 'text-[#f09281]' },
};

export function TranscriptMessages({ dialogue, msgClassName = '', roleClassName = '', chipClassName = '' }: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  return (
    <>
      {dialogue.map((m, i) => {
        const style = ROLE_STYLE[m.role] ?? ROLE_STYLE.parent;
        const cards = Array.isArray(m.content) ? m.content : null;
        const sentence = cards ? (m.content_localized || cards.map(c => c.corpus_name || c.label).join(' ')) : null;

        return (
          <div key={i} className={`${msgClassName} p-3 rounded-xl text-sm border-l-4 ${style.border}`}>
            <div className={`${roleClassName} text-[10px] uppercase font-bold tracking-widest mb-1 ${style.label}`}>
              {m.role}
            </div>
            {cards ? (
              <>
                <div className="text-slate-800">{sentence}</div>
                <button
                  onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
                  className="mt-1.5 text-xs font-bold text-slate-400 underline decoration-dotted hover:text-slate-600"
                >
                  {expanded[i] ? 'Hide cards' : 'View cards'}
                </button>
                {expanded[i] && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {cards.map((c, j) => (
                      <span
                        key={j}
                        className={`${chipClassName} inline-flex items-center bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700`}
                        title={c.corpus_name ? `corpus: ${c.corpus_name}` : c.category}
                      >
                        {c.corpus_name || c.label}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-slate-800">{m.content as string}</div>
            )}
          </div>
        );
      })}
    </>
  );
}
