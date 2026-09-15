import { useState, useEffect } from 'react';
import { adminApi, type SessionRow, type MessageRow } from '../api';
import type { Dyad } from '../types';

interface Props {
  dyad: Dyad;
}

const TOPIC_LABEL: Record<string, string> = {
  plan: "Today's plan",
  recall: "Today's day",
  free: 'Favorite topic',
};

export function TranscriptPanel({ dyad }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(''); setOpenSessionId(null);
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
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-6 py-5 border-b border-slate-200 flex-shrink-0 bg-white">
        <h2 className="text-lg font-extrabold text-slate-800">{dyad.child_name}</h2>
        <p className="text-sm text-slate-500 font-semibold mt-0.5">
          {dyad.alias} · {sessions.length} conversation{sessions.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && <p className="text-slate-400 text-center py-10 font-semibold">Loading…</p>}
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {!loading && sessions.length === 0 && (
          <p className="text-slate-400 text-center py-10 font-semibold">No conversations yet.</p>
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
                    {s.rating != null && <StarRating rating={s.rating} />}
                    <ClientBadge client={s.client} />
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
  );
}

function MessageBubble({ msg }: { msg: MessageRow }) {
  const isParent = msg.role === 'parent';
  const content = msg.content_type === 'text'
    ? String(msg.content)
    : (msg.inferred_sentence ?? null)
      ?? ((msg.content as any[]).map((c: any) => c.corpus_name || c.label).join(' · '));

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

/** Which app produced the conversation. The on-device apps run the card model and the sentence model locally;
 *  'cloud web' is the retired server-LLM client. */
function ClientBadge({ client }: { client?: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    'web-ondevice': { label: 'Web (on-device)', cls: 'bg-teal-100 text-teal-700' },
    'irisspeak.org': { label: 'Web (on-device)', cls: 'bg-teal-100 text-teal-700' },
    'irisspeak.app': { label: 'iPad app', cls: 'bg-indigo-100 text-indigo-700' },
    'irisspeak.com': { label: 'Cloud web (retired)', cls: 'bg-slate-100 text-slate-500' },
  };
  const m = map[client ?? ''] ?? { label: 'Cloud web (retired)', cls: 'bg-slate-100 text-slate-500' };
  return <span className={`text-[11px] font-bold px-2 py-1 rounded-lg whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" title={`${rating}/5`}>
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} className={`text-base ${s <= rating ? 'text-amber-400' : 'text-slate-200'}`}>★</span>
      ))}
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
