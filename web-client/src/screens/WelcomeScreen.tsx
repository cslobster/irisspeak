import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch, logout } from '../store';
import { api } from '../api/client';
import { GearIcon } from '../components/Icons';

interface FlowerProps {
  x: number; y: number;
  color: string; stemColor?: string; size?: number;
}

function Flower({ x, y, color, stemColor = '#4ade80', size = 1 }: FlowerProps) {
  const r = 9 * size, d = 13 * size;
  const petals = [0, 72, 144, 216, 288].map(a => {
    const rad = (a * Math.PI) / 180;
    return { cx: Math.sin(rad) * d, cy: -Math.cos(rad) * d };
  });
  return (
    <g transform={`translate(${x},${y})`}>
      <line x1="0" y1="2" x2="0" y2={52 * size} stroke={stemColor} strokeWidth={3.5 * size} strokeLinecap="round" />
      {petals.map((p, i) => <circle key={i} cx={p.cx} cy={p.cy} r={r} fill={color} opacity="0.92" />)}
      <circle cx="0" cy="0" r={6 * size} fill="#fde047" />
    </g>
  );
}

export function WelcomeScreen() {
  const nav = useNavigate();
  const dispatch = useDispatch();
  const childName = useSelector(s => s.auth.childName) || 'there';
  const [showSettings, setShowSettings] = useState(false);

  function signOut() {
    api.setJwt(null);
    dispatch(logout());
    nav('/', { replace: true });
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
          <div className="absolute right-0 mt-2 w-44 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
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
        style={{ minHeight: '60vh', paddingTop: '4vh' }}
      >
        {/* Greeting */}
        <h1
          className="text-5xl sm:text-7xl font-bold text-center mb-14 select-none"
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
          <p className="text-2xl sm:text-3xl font-bold text-slate-600 select-none tracking-tight">
            Start a conversation
          </p>
          <button
            onClick={() => nav('/who-first')}
            className="flex items-center justify-center shadow-2xl active:scale-95 transition-transform"
            style={{
              width: 200,
              height: 200,
              borderRadius: 40,
              background: 'linear-gradient(135deg, #34d399 0%, #10b981 60%, #059669 100%)',
              boxShadow: '0 12px 40px rgba(16,185,129,0.45)',
            }}
            aria-label="Start a conversation"
          >
            <svg width="80" height="80" viewBox="0 0 72 72" fill="none">
              <path d="M18 12 L62 36 L18 60 Z" fill="white" />
            </svg>
          </button>
        </div>
      </div>

      {/* Hills + flowers */}
      <div className="absolute bottom-0 left-0 right-0" style={{ height: '42vh' }}>
        <svg
          viewBox="0 0 1440 380"
          preserveAspectRatio="xMidYMax slice"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block', width: '100%', height: '100%' }}
        >
          <ellipse cx="720" cy="520" rx="1100" ry="310" fill="#a7f3d0" opacity="0.5" />
          <ellipse cx="720" cy="560" rx="1200" ry="320" fill="#86efac" />
          <Flower x={90}  y={295} color="#f9a8d4" size={1.1} />
          <Flower x={195} y={268} color="#93c5fd" size={0.9} />
          <Flower x={310} y={252} color="#c4b5fd" size={1.0} />
          <Flower x={440} y={243} color="#f9a8d4" size={1.3} />
          <Flower x={570} y={238} color="#93c5fd" size={0.85} />
          <Flower x={680} y={236} color="#f9a8d4" size={1.0} />
          <Flower x={790} y={238} color="#c4b5fd" size={1.2} />
          <Flower x={910} y={242} color="#f9a8d4" size={0.9} />
          <Flower x={1030} y={252} color="#93c5fd" size={1.1} />
          <Flower x={1150} y={265} color="#f9a8d4" size={1.0} />
          <Flower x={1265} y={283} color="#c4b5fd" size={0.9} />
          <Flower x={1370} y={300} color="#f9a8d4" size={1.1} />
        </svg>
      </div>
    </div>
  );
}
