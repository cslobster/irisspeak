import { useState, useEffect, useCallback } from 'react';
import { ConversationsView } from './ConversationsView';
import { AdvancedView } from './AdvancedView';
import { PendingSignupsTab } from './PendingSignupsTab';
import { adminApi } from '../api';

type Page = 'conversations' | 'pending' | 'advanced';

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>('conversations');
  const [pendingCount, setPendingCount] = useState(0);

  // Approving a signup is a gating action (see CONTEXT.md's signup wizard design) — it needs
  // to be immediately visible, not buried behind an "Advanced" button that gives no hint it
  // has anything to do with signups. Refetch whenever we land back on this top-level nav so
  // the badge count doesn't go stale after approving one.
  const refreshPendingCount = useCallback(() => {
    adminApi.listDyads().then(dyads => setPendingCount(dyads.filter(d => d.status === 'pending').length)).catch(() => {});
  }, []);

  useEffect(() => { refreshPendingCount(); }, [refreshPendingCount, page]);

  return (
    <div className="h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">Iris Speak Admin</h1>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Conversations by user</p>
        </div>
        <div className="flex items-center gap-2">
          <NavButton active={page === 'conversations'} onClick={() => setPage('conversations')}>
            Users
          </NavButton>
          <NavButton active={page === 'pending'} onClick={() => setPage('pending')}>
            Pending Signups
            {pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-extrabold">
                {pendingCount}
              </span>
            )}
          </NavButton>
          <NavButton active={page === 'advanced'} onClick={() => setPage('advanced')}>
            Stats &amp; Analytics
          </NavButton>
          <button
            onClick={onLogout}
            className="text-sm font-bold text-slate-500 hover:text-red-500 transition px-4 py-2 rounded-xl hover:bg-red-50 ml-2"
          >
            Sign out
          </button>
        </div>
      </header>

      {page === 'conversations' && <ConversationsView />}
      {page === 'pending' && (
        <div className="flex-1 overflow-auto p-6">
          <PendingSignupsTab />
        </div>
      )}
      {page === 'advanced' && <AdvancedView onBack={() => setPage('conversations')} />}
    </div>
  );
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm font-bold px-4 py-2 rounded-xl transition flex items-center ${
        active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
