import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch, logout } from '../store';
import { api } from '../api/client';
import { GearIcon } from '../components/Icons';
import { FlowerHillsBackdrop } from '../components/FlowerHills';
import { UI_SCALE_LEVELS, UI_SCALE_LABELS, getUiScaleLevel, setUiScaleLevel, type UiScaleLevel } from '../uiScale';

export function WelcomeScreen() {
  const nav = useNavigate();
  const dispatch = useDispatch();
  const childName = useSelector(s => s.auth.childName) || 'there';
  const [showSettings, setShowSettings] = useState(false);
  const [uiScale, setUiScale] = useState<UiScaleLevel>(getUiScaleLevel);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  function signOut() {
    api.setJwt(null);
    dispatch(logout());
    nav('/', { replace: true });
  }

  async function startConversation() {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const sid = await api.newSession({ category: 'plan' }, tz);
      nav(`/session/${encodeURIComponent(sid)}`, { state: { topic: { category: 'plan' } } });
    } catch (e: any) {
      setStartError(e?.response?.data?.detail || e?.message || 'Could not start session.');
      setStarting(false);
    }
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #e0f7f4 0%, #eef4ff 55%, #f9f0ff 100%)' }}
      onClick={() => setShowSettings(false)}
    >
      {/* Decorative blobs */}
      <div className="absolute top-6 left-4 w-24 h-24 rounded-full bg-rose-300/25 blur-md pointer-events-none" />
      <div className="absolute top-10 right-36 w-32 h-32 rounded-full bg-amber-300/20 blur-md pointer-events-none" />
      <div className="absolute top-2 left-32 w-14 h-14 rounded-full bg-purple-300/25 blur-sm pointer-events-none" />
      <div className="absolute top-40 left-12 w-16 h-16 rounded-full bg-sky-300/20 blur-sm pointer-events-none" />

      {/* Settings button — top right */}
      <div className="absolute top-5 right-5 z-30" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setShowSettings(s => !s)}
          className="w-12 h-12 rounded-2xl bg-white/80 backdrop-blur shadow border border-white/60 flex items-center justify-center hover:bg-white transition active:scale-95"
          aria-label="Settings"
        >
          <GearIcon size={22} color="#6b7280" />
        </button>

        {showSettings && (
          <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-slate-100">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 mb-2">
                Text &amp; card size
              </p>
              <div className="flex gap-1.5">
                {UI_SCALE_LEVELS.map(level => (
                  <button
                    key={level}
                    onClick={() => { setUiScaleLevel(level); setUiScale(level); }}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold transition active:scale-95 ${
                      uiScale === level
                        ? 'bg-emerald-500 text-white shadow'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    aria-pressed={uiScale === level}
                  >
                    {UI_SCALE_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={signOut}
              className="w-full text-left px-5 py-4 text-sm font-bold text-red-500 hover:bg-red-50 transition"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Center content */}
      <div
        className="relative z-10 flex flex-col items-center justify-center px-8"
        style={{ minHeight: '75vh', paddingTop: '14vh' }}
      >
        {/* Greeting */}
        <h1
          className="ui-scale-welcome-heading text-5xl sm:text-7xl font-bold text-center mb-14 select-none leading-[1.25] pb-2"
          style={{
            background: 'linear-gradient(135deg, #f43f5e 0%, #a855f7 45%, #0ea5e9 80%, #10b981 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Welcome, {childName}!
        </h1>

        {/* Big play button */}
        <div className="flex flex-col items-center gap-5">
          <p className="ui-scale-welcome-subtitle text-2xl sm:text-3xl font-bold text-slate-600 select-none tracking-tight">
            Start a conversation
          </p>
          <button
            onClick={startConversation}
            disabled={starting}
            className="flex items-center justify-center shadow-2xl active:scale-95 disabled:opacity-60 transition-transform"
            style={{
              width: 200,
              height: 200,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #34d399 0%, #10b981 60%, #059669 100%)',
              boxShadow: '0 12px 40px rgba(16,185,129,0.45)',
            }}
            aria-label="Start a conversation"
          >
            {starting ? (
              <div className="w-10 h-10 border-4 border-white/40 border-t-white rounded-full animate-spin motion-reduce:animate-none" />
            ) : (
              <svg width="80" height="80" viewBox="0 0 72 72" fill="none">
                <path d="M18 12 L62 36 L18 60 Z" fill="white" />
              </svg>
            )}
          </button>
          {startError && (
            <p className="text-red-500 font-bold text-base">{startError}</p>
          )}
        </div>
      </div>

      {/* Hills + flowers */}
      <FlowerHillsBackdrop />
    </div>
  );
}
