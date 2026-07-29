import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { HillBackground } from '../components/HillBackground';
import { CloseIcon, StarIcon } from '../components/Icons';
import type { ExtendedSessionInfo, TopicCategory } from '../api/types';

const topicLabels: Record<TopicCategory, string> = {
  plan: '',
  recall: "Today's day",
  free: 'Favorites',
};

const topicTint: Record<TopicCategory, string> = {
  plan: 'border-topicplan-fg bg-topicplan-bg',
  recall: 'border-topicrecall-fg bg-topicrecall-bg',
  free: 'border-topicfree-fg bg-topicfree-bg',
};

export function StarsScreen() {
  const nav = useNavigate();
  const [sessions, setSessions] = useState<ExtendedSessionInfo[]>([]);

  useEffect(() => {
    api.listSessions().then(r => {
      const sorted = [...r.sessions].sort((a, b) => (b.started_timestamp || 0) - (a.started_timestamp || 0));
      setSessions(sorted);
    }).catch(() => {});
  }, []);

  const totalStars = sessions.reduce((sum, s) => sum + Math.floor((s.num_turns || 0) / 2), 0);

  function fmtDate(ms: number) {
    const d = new Date(ms);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <HillBackground>
      <div className="min-h-screen px-8 py-8 max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-extrabold text-slate-700">Stars earned from your conversations</h2>
          <button onClick={() => nav(-1)} className="rounded-xl p-2 bg-white shadow border"><CloseIcon /></button>
        </header>

        <div className="bg-amber-100 border-2 border-amber-300 rounded-3xl p-6 flex items-center gap-4 mb-6">
          <StarIcon size={64} />
          <div>
            <div className="text-4xl font-extrabold text-amber-700">{totalStars}</div>
            <div className="text-sm font-semibold text-amber-800">stars from {sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <div className="space-y-3">
          {sessions.length === 0 ? (
            <p className="text-center text-slate-500 py-12">No conversations yet. Start one from the home screen!</p>
          ) : sessions.map(s => {
            const stars = Math.floor((s.num_turns || 0) / 2);
            const cat = (s.topic?.category as TopicCategory) || 'plan';
            return (
              <div key={s.id} className={`p-4 rounded-2xl border-l-4 ${topicTint[cat]} bg-white/80 flex items-center justify-between`}>
                <div>
                  <div className="font-bold text-slate-800">
                    {s.title || `${topicLabels[cat]}${s.topic?.subtopic ? ` · ${s.topic.subtopic}` : ''}`}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {fmtDate(s.started_timestamp)} · {s.num_turns || 0} turn{s.num_turns === 1 ? '' : 's'} · {s.status}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {Array.from({ length: stars }).slice(0, 8).map((_, i) => <StarIcon key={i} size={22} />)}
                  {stars > 8 && <span className="text-sm font-bold text-amber-600">+{stars - 8}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </HillBackground>
  );
}
