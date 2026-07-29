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
  const [rating, setRating] = useState<number | null>(null);
  const [hovered, setHovered] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    Promise.all([
      api.getDialogue(sessionId).catch(() => ({ dialogue: [] as DialogueMessage[] })),
      api.listSessions().catch(() => ({ sessions: [] })),
    ]).then(([d, l]) => {
      setDialogue(d.dialogue || []);
      const s = (l.sessions || []).find(x => x.id === sessionId);
      if (s?.rating) { setRating(s.rating); setSubmitted(true); }
    });
  }, [sessionId]);

  function handleRate(r: number) {
    if (submitted || !sessionId) return;
    setRating(r);
    setSubmitted(true);
    api.rateSession(sessionId, r).catch(() => {});
  }

  return (
    <HillBackground>
      <div className="min-h-screen px-8 py-10 max-w-3xl mx-auto flex flex-col items-center">
        <h2 className="text-3xl font-extrabold text-slate-700 mb-2">Great conversation!</h2>
        <p className="text-base text-slate-500 mb-8">Here's what you talked about today.</p>

        {/* 5-star rating prompt */}
        <div className="bg-white border-2 border-amber-200 rounded-3xl px-8 py-6 flex flex-col items-center gap-3 mb-8 shadow w-full max-w-md">
          {!submitted ? (
            <>
              <p className="text-lg font-bold text-slate-700">How did the conversation go?</p>
              <p className="text-sm text-slate-500 mb-1">Tap a star to rate it together</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <button
                    key={s}
                    onClick={() => handleRate(s)}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    className="transition-transform active:scale-90"
                    aria-label={`Rate ${s} star${s > 1 ? 's' : ''}`}
                  >
                    <StarIcon size={52} fill={(hovered || 0) >= s || (rating || 0) >= s ? '#fbbf24' : '#e2e8f0'} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-slate-700">Thanks for rating!</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <StarIcon key={s} size={44} fill={(rating || 0) >= s ? '#fbbf24' : '#e2e8f0'} />
                ))}
              </div>
              <p className="text-sm text-slate-500">{rating} out of 5 stars</p>
            </>
          )}
        </div>

        <div className="self-stretch bg-white rounded-3xl p-5 shadow border border-slate-200/60 mb-8">
          <h3 className="font-extrabold text-slate-700 mb-3">Conversation transcript</h3>
          {dialogue.length === 0 ? (
            <p className="text-slate-400 italic">Nothing was said this session.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-auto">
              {dialogue.map((m, i) => (
                <div key={i} className={`p-3 rounded-xl text-sm ${m.role === 'parent' ? 'bg-[#94c1c2]/10 border-l-4 border-[#94c1c2]' : 'bg-purple-50 border-l-4 border-purple-300'}`}>
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">{m.role}</div>
                  {Array.isArray(m.content) ? (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {m.content.map((c, j) => (
                        <span key={j}
                              className="inline-flex items-center bg-white border border-purple-200 rounded-lg px-2 py-1 text-xs font-bold text-purple-800 shadow-sm"
                              title={c.corpus_name ? `corpus: ${c.corpus_name}` : c.category}>
                          {c.category === 'emotion' ? c.label : (c.corpus_name || c.label)}
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
          <button onClick={() => { analytics.sessionEndGoHome(); nav('/home', { replace: true }); }} className="pill-btn bg-[#94c1c2]">Back to home</button>
          <button onClick={() => { analytics.sessionEndViewStars(); nav('/stars'); }} className="pill-btn bg-amber-400">See all stars</button>
        </div>
      </div>
    </HillBackground>
  );
}
