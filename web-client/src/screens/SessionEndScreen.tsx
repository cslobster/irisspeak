import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { analytics } from '../api/analytics';
import { HillBackground } from '../components/HillBackground';
import { StarIcon } from '../components/Icons';
import type { DialogueMessage } from '../api/types';
import { emojiForCard } from '../cardEmoji';

export function SessionEndScreen() {
  const nav = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [dialogue, setDialogue] = useState<DialogueMessage[]>([]);
  const [stars, setStars] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([
      api.getDialogue(sessionId).catch(() => ({ dialogue: [] as DialogueMessage[] })),
      api.listSessions().catch(() => ({ sessions: [] })),
    ]).then(([d, l]) => {
      setDialogue(d.dialogue || []);
      const s = (l.sessions || []).find(x => x.id === sessionId);
      if (s) setStars(Math.floor((s.num_turns || 0) / 2));
      else setStars(Math.floor((d.dialogue?.length || 0) / 4));
    });
  }, [sessionId]);

  return (
    <HillBackground>
      <div className="min-h-screen px-8 py-10 max-w-3xl mx-auto flex flex-col items-center">
        <h2 className="text-3xl font-extrabold text-slate-700 mb-2">Great conversation!</h2>
        <p className="text-base text-slate-500 mb-8">Here's what you talked about today.</p>

        <div className="bg-amber-100 border-2 border-amber-300 rounded-3xl px-8 py-6 flex items-center gap-4 mb-8 shadow">
          <div className="flex gap-1">
            {Array.from({ length: Math.max(stars, 1) }).slice(0, 6).map((_, i) => <StarIcon key={i} size={42} />)}
          </div>
          <div>
            <div className="text-3xl font-extrabold text-amber-700">{stars} {stars === 1 ? 'star' : 'stars'}</div>
            <div className="text-sm font-semibold text-amber-800">earned from this conversation</div>
          </div>
        </div>

        <div className="self-stretch bg-white rounded-3xl p-5 shadow border border-slate-200/60 mb-8">
          <h3 className="font-extrabold text-slate-700 mb-3">Conversation transcript</h3>
          {dialogue.length === 0 ? (
            <p className="text-slate-400 italic">Nothing was said this session.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-auto">
              {dialogue.map((m, i) => (
                <div key={i} className={`p-3 rounded-xl text-sm ${m.role === 'parent' ? 'bg-blue-50 border-l-4 border-blue-300' : 'bg-purple-50 border-l-4 border-purple-300'}`}>
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">{m.role}</div>
                  {Array.isArray(m.content) ? (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {m.content.map((c, j) => (
                        <span key={j}
                              className="inline-flex items-center bg-white border border-purple-200 rounded-lg px-2 py-1 text-xs font-bold text-purple-800 shadow-sm"
                              title={c.corpus_name ? `corpus: ${c.corpus_name}` : c.category}>
                          {c.corpus_name || c.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-800">{m.content}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={() => { analytics.sessionEndGoHome(); nav('/home', { replace: true }); }} className="pill-btn bg-emerald-500">Back to home</button>
          <button onClick={() => { analytics.sessionEndViewStars(); nav('/stars'); }} className="pill-btn bg-amber-400">See all stars</button>
        </div>
      </div>
    </HillBackground>
  );
}
