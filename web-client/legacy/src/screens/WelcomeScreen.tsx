import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from '../store';
import { api } from '../api/client';

export function WelcomeScreen() {
  const nav = useNavigate();
  const childName = useSelector(s => s.auth.childName) || 'there';
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

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
      style={{ background: '#f0ebe1' }}
    >
      {/* Center content */}
      <div
        className="relative z-10 flex flex-col items-center justify-center px-8"
        style={{ minHeight: '75vh', paddingTop: '14vh' }}
      >
        {/* Greeting */}
        <h1
          className="ui-scale-welcome-heading text-5xl sm:text-7xl font-bold text-center mb-14 select-none leading-[1.25] pb-2 tracking-tight text-black"
        >
          Welcome, <span style={{ color: '#f09281' }}>{childName.charAt(0).toUpperCase() + childName.slice(1)}</span><span style={{ color: '#f09281' }}>!</span>
        </h1>

        {/* Big play button */}
        <div className="flex flex-col items-center gap-5">
          <div className="flex flex-col items-center gap-24">
            <p className="ui-scale-welcome-subtitle text-2xl sm:text-3xl font-bold text-slate-800 select-none tracking-tight">
              Start a conversation
            </p>
            <div className="relative">
              {/* Playful pointer — sits above the button, arrow bends left and down into it */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+8px)] pointer-events-none select-none">
                <svg width="68" height="86" viewBox="0 0 78 90" fill="none">
                  <path
                    d="M55 8 C 70 25, 55 55, 18 76"
                    stroke="#000"
                    strokeWidth="4"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M18 76 L34 73 M18 76 L28 64"
                    stroke="#000"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <button
              onClick={startConversation}
              disabled={starting}
              className="flex items-center justify-center active:scale-95 disabled:opacity-60 transition-transform"
              style={{
                width: 200,
                height: 200,
                borderRadius: '50%',
                background: '#94c1c2',
                boxSizing: 'border-box',
                border: '4px solid #000',
                borderBottomWidth: 10,
              }}
              aria-label="Start a conversation"
            >
              {starting ? (
                <div className="w-10 h-10 border-4 border-white/40 border-t-white rounded-full animate-spin motion-reduce:animate-none" />
              ) : (
                <svg width="80" height="80" viewBox="0 0 72 72" fill="none">
                  <path
                    d="M18 12 L62 36 L18 60 Z"
                    fill="white"
                    stroke="white"
                    strokeWidth="8"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
            </div>
          </div>
          {startError && (
            <p className="text-[#f09281] font-bold text-base">{startError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
