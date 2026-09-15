import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { setFreeTopics, useDispatch, useSelector } from '../store';
import { HillBackground } from '../components/HillBackground';
import { CloseIcon, StarIcon } from '../components/Icons';
import { emojiForCard } from '../cardEmoji';
import { Spinner } from '../components/Spinner';

export function FreeTopicScreen() {
  const nav = useNavigate();
  const dispatch = useDispatch();
  const freeTopics = useSelector(s => s.auth.freeTopics);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  // Fetch free topics on mount if the redux store didn't have them
  // (e.g. user reloaded the page after a previous login). Includes a hard
  // 12s timeout so the spinner can't get stuck silently.
  useEffect(() => {
    if (freeTopics.length > 0) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setError('Server didn\'t respond in 12 s. Check your connection or sign in again.');
        setLoading(false);
      }
    }, 12000);

    api.getFreeTopics()
      .then((details) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        dispatch(setFreeTopics(details));
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        const status = e?.response?.status;
        if (status === 401) {
          setError('Session expired — please sign in again.');
        } else {
          setError(e?.response?.data?.detail || e?.message || 'Failed to load free topics');
        }
        setLoading(false);
      });

    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [freeTopics.length, dispatch, attempt]);

  async function pick(subtopic: string, subtopicDesc: string) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sid = await api.newSession({ category: 'free', subtopic, subtopic_description: subtopicDesc }, tz);
    nav(`/session/${encodeURIComponent(sid)}`, {
      state: { topic: { category: 'free', subtopic, subtopic_description: subtopicDesc } },
    });
  }

  return (
    <HillBackground topic="free">
      <div className="min-h-screen px-8 py-8 flex flex-col items-center">
        <header className="self-stretch flex items-center justify-between mb-10 max-w-3xl w-full mx-auto">
          <h2 className="text-2xl font-extrabold text-orange-700">Pick a free topic</h2>
          <button onClick={() => nav(-1)} className="rounded-xl p-2 bg-white/70 shadow border border-orange-200">
            <CloseIcon />
          </button>
        </header>
        <p className="text-base font-bold text-slate-600 mb-6">Please select a card you would like to talk about.</p>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <Spinner size={80} />
            <p className="text-sm font-bold text-slate-500">Loading favorite topics…</p>
            <button
              onClick={() => setAttempt(a => a + 1)}
              className="text-xs font-bold text-slate-400 underline hover:text-slate-600 mt-2"
            >Taking too long? Retry</button>
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl p-6 shadow border-2 border-rose-200 max-w-md text-center">
            <p className="text-rose-600 font-bold mb-3">{error}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setAttempt(a => a + 1)} className="pill-btn bg-rose-400">Try again</button>
              <button onClick={() => nav('/?expired=1')} className="pill-btn bg-slate-400">Sign in again</button>
            </div>
          </div>
        ) : freeTopics.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 shadow border-2 border-amber-200 max-w-md text-center">
            <p className="text-amber-700 font-bold mb-2">No free topics yet.</p>
            <p className="text-sm text-slate-500 mb-4">An admin can add favorites for the child (e.g. dinosaurs, Lego, Bluey).</p>
            <button onClick={() => nav('/home')} className="pill-btn bg-amber-400">Back home</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl w-full">
            {freeTopics.map(t => {
              const emoji = emojiForCard(t.subtopic, 'topic');
              return (
                <button
                  key={t.id}
                  onClick={() => pick(t.subtopic, t.subtopic_description)}
                  className="bg-white rounded-3xl p-5 text-left shadow-md hover:shadow-xl motion-safe:hover:-translate-y-1 motion-reduce:hover:translate-y-0 active:scale-95 transition-all border-2 border-topicfree-dimmed flex flex-col gap-2"
                >
                  <div className="bg-topicfree-dimmed/60 rounded-2xl flex items-center justify-center h-32 mb-2">
                    <span className="text-7xl drop-shadow-sm" role="img" aria-label={t.subtopic}>{emoji}</span>
                  </div>
                  <div className="text-2xl font-extrabold text-orange-600">{t.subtopic}</div>
                  <div className="text-sm text-slate-600 line-clamp-2">{t.subtopic_description}</div>
                  <div className="mt-auto flex items-center gap-1 pt-2 text-xs font-bold text-amber-600">
                    <StarIcon size={16} /> Favorite
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </HillBackground>
  );
}
