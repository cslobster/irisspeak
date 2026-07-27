import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HillBackground } from '../components/HillBackground';
import { api } from '../api/client';
import { useSelector } from '../store';

export function WhoFirstScreen() {
  const nav = useNavigate();
  const childName = useSelector(s => s.auth.childName) || 'Child';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const sid = await api.newSession({ category: 'plan' }, tz);
      nav(`/session/${encodeURIComponent(sid)}`, { state: { topic: { category: 'plan' } } });
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Could not start session.');
      setLoading(false);
    }
  }

  return (
    <HillBackground>
      <div className="min-h-screen flex flex-col items-center justify-center px-6 pb-16 gap-12">
        <h2 className="text-5xl font-extrabold text-slate-700 text-center">Who's talking first?</h2>

        {error && (
          <p className="text-red-500 font-bold text-base">{error}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-8 w-full max-w-2xl">
          <button
            onClick={start}
            disabled={loading}
            className="flex-1 bg-blue-500 hover:bg-blue-600 active:scale-95 disabled:opacity-50 text-white font-extrabold text-4xl rounded-3xl px-10 py-20 shadow-xl transition-all flex flex-col items-center gap-5"
          >
            <span className="text-8xl">🧑‍🦱</span>
            Caregiver
          </button>

          <button
            onClick={start}
            disabled={loading}
            className="flex-1 bg-purple-500 hover:bg-purple-600 active:scale-95 disabled:opacity-50 text-white font-extrabold text-4xl rounded-3xl px-10 py-20 shadow-xl transition-all flex flex-col items-center gap-5"
          >
            <span className="text-8xl">🧒</span>
            {childName}
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-3 text-slate-500 font-bold text-xl">
            <div className="w-7 h-7 border-2 border-slate-300 border-t-amber-400 rounded-full animate-spin motion-reduce:animate-none" />
            Starting…
          </div>
        )}

        <button
          onClick={() => nav('/home')}
          disabled={loading}
          className="text-2xl font-bold text-slate-400 hover:text-slate-600 underline px-6 py-3"
        >
          ← Back
        </button>
      </div>
    </HillBackground>
  );
}
