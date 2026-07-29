import { useState } from 'react';
import { ConversationsView } from './ConversationsView';
import { AdvancedView } from './AdvancedView';

type Page = 'conversations' | 'advanced';

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>('conversations');

  return (
    <div className="h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800">AACessTalk Admin</h1>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Conversations by user</p>
        </div>
        <div className="flex items-center gap-4">
          {page === 'conversations' && (
            <button
              onClick={() => setPage('advanced')}
              className="text-xs font-bold text-slate-400 hover:text-indigo-600 transition"
            >
              Advanced (stats &amp; analytics) →
            </button>
          )}
          <button
            onClick={onLogout}
            className="text-sm font-bold text-slate-500 hover:text-red-500 transition px-4 py-2 rounded-xl hover:bg-red-50"
          >
            Sign out
          </button>
        </div>
      </header>

      {page === 'conversations' ? (
        <ConversationsView />
      ) : (
        <AdvancedView onBack={() => setPage('conversations')} />
      )}
    </div>
  );
}
