import { useState, useEffect } from 'react';
import { adminApi, type SessionRow, type MessageRow } from '../api';
import type { Dyad } from '../types';

interface Props {
  dyad: Dyad;
  onClose: () => void;
}

const TOPIC_LABEL: Record<string, string> = {
  plan: "Today's plan",
  recall: "Today's day",
  free: 'Favorite topic',
};

export function TranscriptsDrawer({ dyad, onClose }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError('');
    adminApi.getTranscripts(dyad.id)
      .then(({ sessions, messages }) => {
        setSessions(sessions);
        setMessages(messages);
        if (sessions.length > 0) setOpenSessionId(sessions[0].id);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [dyad.id]);

  const messagesBySession = messages.reduce<Record<string, MessageRow[]>>((acc, m) => {
    (acc[m.session_id] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="ml-auto w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between flex-shrink-0 bg-slate-50">
          <div>
            <h2 className="text-lg font-extrabold text-slate-800">Transcripts</h2>
            <p className="text-sm text-slate-500 font-semibold mt-0.5">
              {dyad.alias} · {dyad.child_name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl font-bold leading-none ml-4"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && <p className="text-slate-400 text-center py-10 font-semibold">Loading…</p>}
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {!loading && sessions.length === 0 && (
            <p className="text-slate-400 text-center py-10 font-semibold">No sessions yet.</p>
          )}

          <div className="space-y-3">
            {sessions.map(s => {
              const msgs = messagesBySession[s.id] ?? [];
              const isOpen = openSessionId === s.id;
              const date = new Date(s.created_at).toLocaleString();
              const topic = TOPIC_LABEL[s.topic_category] ?? s.topic_category;
              const label = s.subtopic ? `${topic} · ${s.subtopic}` : topic;

              return (
                <div key={s.id} className="border-2 border-slate-200 rounded-2xl overflow-hidden">
                  <button
                    className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-slate-50 transition"
                    onClick={() => setOpenSessionId(isOpen ? null : s.id)}
                  >
                    <div>
                      <div className="font-bold text-slate-700 text-sm">{label}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{date} · {s.num_turns} turns · {msgs.length} messages</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={s.status} />
                      <span className="text-slate-400 text-lg">{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 px-5 py-4 space-y-2 max-h-96 overflow-y-auto bg-slate-50/50">
                      {msgs.length === 0 ? (
                        <p className="text-slate-400 text-sm italic">No messages in this session.</p>
                      ) : (
                        msgs.map(m => <MessageBubble key={m.id} msg={m} />)
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: MessageRow }) {
  const isParent = msg.role === 'parent';
  const content = msg.content_type === 'text'
    ? String(msg.content)
    : Array.isArray(msg.content)
      ? (msg.content as any[]).map((c: any) => c.corpus_name || c.label).join(' · ')
      : JSON.stringify(msg.content);

  return (
    <div className={`flex ${isParent ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-xs rounded-2xl px-4 py-2.5 text-sm ${
        isParent
          ? 'bg-blue-100 text-blue-900 rounded-br-sm'
          : 'bg-purple-100 text-purple-900 rounded-bl-sm'
      }`}>
        <div className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">{msg.role}</div>
        <div className="font-medium leading-snug">{content}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    terminated: 'bg-emerald-100 text-emerald-700',
    conversation: 'bg-amber-100 text-amber-700',
    started: 'bg-sky-100 text-sky-700',
    initial: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg capitalize ${colors[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}
