import { useState } from 'react';
import { UsersTab } from './UsersTab';
import { StatsTab } from './StatsTab';
import { AnalyticsTab } from './AnalyticsTab';

type Tab = 'users' | 'stats' | 'analytics';

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">AACessTalk Admin</h1>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Manage users &amp; monitor usage</p>
        </div>
        <button
          onClick={onLogout}
          className="text-sm font-bold text-slate-500 hover:text-red-500 transition px-4 py-2 rounded-xl hover:bg-red-50"
        >
          Sign out
        </button>
      </header>

      <nav className="bg-white border-b border-slate-200 px-6 flex gap-1">
        {(['users', 'stats', 'analytics'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-3.5 text-sm font-bold capitalize transition border-b-2 -mb-px ${
              tab === t
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'stats' ? 'Usage Stats' : t === 'analytics' ? 'Analytics' : 'Users'}
          </button>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto">
        {tab === 'users' && <UsersTab />}
        {tab === 'stats' && <StatsTab />}
        {tab === 'analytics' && <AnalyticsTab />}
      </main>
    </div>
  );
}
