import { useMemo, useState } from 'react';
import type { CardInfo, DialogueMessage } from '../api/types';

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

// The child can bank several sentences in a row (one dialogue_turn/message each)
// before handing off to the parent -- group consecutive same-role messages into
// one bubble so a multi-sentence turn reads as a single combined statement
// instead of a stack of near-identical bubbles.
function groupByTurnStreak(dialogue: DialogueMessage[]): DialogueMessage[][] {
  const groups: DialogueMessage[][] = [];
  for (const m of dialogue) {
    const last = groups[groups.length - 1];
    if (last && last[0].role === m.role) last.push(m);
    else groups.push([m]);
  }
  return groups;
}

export function TranscriptMessages({ dialogue, msgClassName = '', roleClassName = '', chipClassName = '' }: Props) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const groups = useMemo(() => groupByTurnStreak(dialogue), [dialogue]);

  return (
    <>
      {groups.map((group, i) => {
        const first = group[0];
        const style = ROLE_STYLE[first.role] ?? ROLE_STYLE.parent;
        const isCards = group.every(m => Array.isArray(m.content));
        const cards = isCards ? group.flatMap(m => m.content as CardInfo[]) : null;
        const sentence = isCards
          ? group
              .map(m => m.content_localized || (m.content as CardInfo[]).map(c => c.corpus_name || c.label).join(' '))
              .join(' ')
          : null;

        return (
          <div key={i} className={`${msgClassName} p-3 rounded-xl text-sm border-l-4 ${style.border}`}>
            <div className={`${roleClassName} text-[10px] uppercase font-bold tracking-widest mb-1 ${style.label}`}>
              {first.role}
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
              <div className="text-slate-800">{group.map(m => m.content as string).join(' ')}</div>
            )}
          </div>
        );
      })}
    </>
  );
}
