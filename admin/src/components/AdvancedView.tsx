import { useState } from 'react';
import { StatsTab } from './StatsTab';
import { AnalyticsTab } from './AnalyticsTab';

type SubTab = 'stats' | 'analytics';

export function AdvancedView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<SubTab>('stats');

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-6 flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-sm font-bold text-slate-400 hover:text-slate-600 transition pr-4 py-3.5"
        >
          ← Back to conversations
        </button>
        {(['stats', 'analytics'] as SubTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-3.5 text-sm font-bold transition border-b-2 -mb-px ${
              tab === t
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'stats' ? 'Usage Stats' : 'Analytics'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === 'stats' && <StatsTab />}
        {tab === 'analytics' && <AnalyticsTab />}
      </div>
    </div>
  );
}
