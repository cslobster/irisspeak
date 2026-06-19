import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HillBackground } from '../components/HillBackground';
import { api } from '../api/client';

export function WhoFirstScreen() {
  const nav = useNavigate();
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
      <div className="min-h-screen flex flex-col items-center justify-center px-8 pb-32 gap-10">
        <h2 className="text-3xl font-extrabold text-slate-700 text-center">Who's talking first?</h2>

        {error && (
          <p className="text-red-500 font-bold text-sm">{error}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-6 w-full max-w-lg">
          <button
            onClick={start}
            disabled={loading}
            className="flex-1 bg-blue-500 hover:bg-blue-600 active:scale-95 disabled:opacity-50 text-white font-extrabold text-2xl rounded-3xl px-8 py-12 shadow-xl transition-all flex flex-col items-center gap-3"
          >
            <span className="text-5xl">🧑‍🦱</span>
            Parent
          </button>

          <button
            onClick={start}
            disabled={loading}
            className="flex-1 bg-purple-500 hover:bg-purple-600 active:scale-95 disabled:opacity-50 text-white font-extrabold text-2xl rounded-3xl px-8 py-12 shadow-xl transition-all flex flex-col items-center gap-3"
          >
            <span className="text-5xl">🧒</span>
            Child
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-3 text-slate-500 font-bold">
            <div className="w-5 h-5 border-2 border-slate-300 border-t-amber-400 rounded-full animate-spin" />
            Starting…
          </div>
        )}

        <button
          onClick={() => nav('/home')}
          disabled={loading}
          className="text-xs font-bold text-slate-400 hover:text-slate-600 underline"
        >
          ← Back
        </button>
      </div>
    </HillBackground>
  );
}
