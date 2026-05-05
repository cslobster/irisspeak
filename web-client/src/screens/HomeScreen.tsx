import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { TopicButton } from '../components/TopicButton';
import { CalendarIcon, HomeIcon, StarIcon, MenuIcon } from '../components/Icons';
import { HillBackground } from '../components/HillBackground';
import { useSelector, useDispatch, logout } from '../store';
import type { ExtendedSessionInfo, TopicCategory } from '../api/types';

interface Counts { today: number; total: number; stars: number; }
const empty: Counts = { today: 0, total: 0, stars: 0 };

export function HomeScreen() {
  const nav = useNavigate();
  const dispatch = useDispatch();
  const childName = useSelector(s => s.auth.childName) || 'your child';
  const [serverOk, setServerOk] = useState(true);
  const [counts, setCounts] = useState<Record<TopicCategory, Counts>>({
    plan: empty, recall: empty, free: empty,
  });
  const totalStars = counts.plan.stars + counts.recall.stars + counts.free.stars;

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await api.ping();
      if (!cancelled) setServerOk(ok);
    };
    const refreshSessions = async () => {
      try {
        const r = await api.listSessions();
        const today = new Date(); today.setHours(0,0,0,0);
        const startMs = today.getTime();
        const next: Record<TopicCategory, Counts> = { plan: { ...empty }, recall: { ...empty }, free: { ...empty } };
        r.sessions.forEach((s: ExtendedSessionInfo) => {
          const cat = s.topic?.category as TopicCategory;
          if (!next[cat]) return;
          next[cat].total += 1;
          next[cat].stars += Math.floor((s.num_turns || 0) / 2);
          if ((s.started_timestamp || 0) >= startMs) next[cat].today += 1;
        });
        if (!cancelled) setCounts(next);
      } catch {}
    };
    check(); refreshSessions();
    const id = setInterval(check, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function startSession(category: TopicCategory) {
    if (category === 'free') { nav('/free-topic'); return; }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sid = await api.newSession({ category }, tz);
    nav(`/session/${encodeURIComponent(sid)}`, { state: { topic: { category } } });
  }

  return (
    <HillBackground>
      <div className="min-h-screen px-10 py-8 flex flex-col">
        <header className="flex items-center justify-between mb-8">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500 font-bold">Welcome</p>
            <h1 className="text-3xl font-extrabold text-slate-700 mt-1">Hi, {childName}!</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${serverOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {serverOk ? 'Backend connected' : 'Backend unreachable'}
            </span>
            <button
              onClick={() => nav('/stars')}
              className="rounded-xl px-3 py-2 bg-amber-300 hover:bg-amber-400 text-amber-900 font-bold shadow flex items-center gap-2"
              title="Earned stars"
            >
              <StarIcon size={20} /> {totalStars}
            </button>
            <button
              onClick={() => { api.setJwt(null); dispatch(logout()); nav('/', { replace: true }); }}
              className="rounded-xl p-3 bg-white shadow border border-slate-200 hover:bg-slate-50"
              title="Sign out"
            >
              <MenuIcon />
            </button>
          </div>
        </header>

        <p className="text-lg text-slate-600 mb-6 font-semibold">What would you like to talk about?</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full">
          <TopicButton
            topic="plan" title="Today's plan" icon={<CalendarIcon />} iconRotate={10}
            today={counts.plan.today} total={counts.plan.total}
            onClick={() => startSession('plan')}
          />
          <TopicButton
            topic="recall" title="Today's day" icon={<HomeIcon />} iconRotate={-8}
            today={counts.recall.today} total={counts.recall.total}
            onClick={() => startSession('recall')}
          />
          <TopicButton
            topic="free" title={`${childName}'s favorite`} icon={<StarIcon />} iconRotate={-8}
            today={counts.free.today} total={counts.free.total}
            onClick={() => startSession('free')}
          />
        </div>
      </div>
    </HillBackground>
  );
}
