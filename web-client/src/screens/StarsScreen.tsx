import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/local';
import { CloseIcon, StarIcon } from '../components/Icons';
import { TranscriptMessages } from '../components/Transcript';
import type { DialogueMessage, ExtendedSessionInfo, TopicCategory } from '../api/types';

const topicLabels: Record<TopicCategory, string> = {
  plan: 'Conversation',
  recall: "Today's day",
  free: 'Favorites',
};

export function StarsScreen() {
  const nav = useNavigate();
  const [sessions, setSessions] = useState<ExtendedSessionInfo[]>([]);
  const [selected, setSelected] = useState<ExtendedSessionInfo | null>(null);
  const [dialogue, setDialogue] = useState<DialogueMessage[]>([]);
  const [loadingDialogue, setLoadingDialogue] = useState(false);

  useEffect(() => {
    api.listSessions().then(r => {
      const sorted = [...r.sessions].sort((a, b) => (b.started_timestamp || 0) - (a.started_timestamp || 0));
      setSessions(sorted);
    }).catch(() => {});
  }, []);

  function fmtDate(ms: number) {
    const d = new Date(ms);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function openTranscript(s: ExtendedSessionInfo) {
    setSelected(s);
    setDialogue([]);
    setLoadingDialogue(true);
    api.getDialogue(s.id)
      .then(d => setDialogue(d.dialogue || []))
      .catch(() => setDialogue([]))
      .finally(() => setLoadingDialogue(false));
  }

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#f0ebe1' }}>
      <div className="min-h-screen px-8 py-8 max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-extrabold text-black">Your conversations</h2>
          <button onClick={() => nav(-1)} className="rounded-xl p-2 bg-white border-2 border-b-4 border-black"><CloseIcon /></button>
        </header>

        <div className="space-y-3">
          {sessions.length === 0 ? (
            <p className="text-center text-slate-500 py-12">No conversations yet. Start one from the home screen!</p>
          ) : sessions.map(s => {
            const cat = (s.topic?.category as TopicCategory) || 'plan';
            return (
              <button
                key={s.id}
                onClick={() => openTranscript(s)}
                className="w-full text-left p-4 rounded-2xl border-2 border-b-4 border-black bg-white hover:bg-slate-50 active:scale-[0.99] transition flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-slate-800">
                    {s.title || `${topicLabels[cat]}${s.topic?.subtopic ? ` · ${s.topic.subtopic}` : ''}`}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {fmtDate(s.started_timestamp)} · {s.num_turns || 0} turn{s.num_turns === 1 ? '' : 's'} · {s.status}
                  </div>
                </div>
                {s.rating ? (
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {[1, 2, 3, 4, 5].map(i => <StarIcon key={i} size={16} fill={s.rating! >= i ? '#f09281' : '#e2e8f0'} stroke="#000" strokeWidth={16} shadow />)}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400 flex-shrink-0">Not rated</span>
                )}
              </button>
            );
          })}
        </div>

        {selected && (
          <div
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setSelected(null)}
          >
            <div
              className="bg-white rounded-3xl w-full max-w-lg max-h-[80dvh] flex flex-col overflow-hidden"
              style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div>
                  <h3 className="text-xl font-extrabold text-slate-800">
                    {selected.title || topicLabels[(selected.topic?.category as TopicCategory) || 'plan']}
                  </h3>
                  <div className="text-xs text-slate-500 mt-0.5">{fmtDate(selected.started_timestamp)}</div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="w-9 h-9 rounded-full bg-white flex items-center justify-center transition-colors flex-shrink-0"
                  style={{ boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 4 }}
                  aria-label="Close transcript"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-500">Rating:</span>
                {selected.rating ? (
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map(i => <StarIcon key={i} size={20} fill={selected.rating! >= i ? '#f09281' : '#e2e8f0'} stroke="#000" strokeWidth={16} shadow />)}
                  </div>
                ) : (
                  <span className="text-sm text-slate-400 italic">Not rated</span>
                )}
              </div>

              <div className="overflow-y-auto p-5 flex-1">
                {loadingDialogue ? (
                  <p className="text-slate-400 text-center py-8">Loading…</p>
                ) : dialogue.length === 0 ? (
                  <p className="text-slate-400 italic text-center py-8">Nothing was said this session.</p>
                ) : (
                  <div className="space-y-2">
                    <TranscriptMessages dialogue={dialogue} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
