import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './Icons';

interface CboardCard {
  word: string;
  image_url: string;
  category: string;
}

let _cache: CboardCard[] | null = null;

async function loadCards(): Promise<CboardCard[]> {
  if (_cache) return _cache;
  const r = await fetch('/cboard_cards.json');
  _cache = await r.json();
  return _cache!;
}

interface Props {
  onSelect: (word: string, category: string, image_url: string | null) => void;
  onClose: () => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  topic:   'bg-card-topic',
  action:  'bg-card-action',
  emotion: 'bg-card-emotion',
  core:    'bg-card-core',
};

export function CardSearchOverlay({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [allCards, setAllCards] = useState<CboardCard[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCards().then(setAllCards);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.toLowerCase().trim();
  const filtered = q.length === 0
    ? allCards
    : allCards.filter(c => c.word.toLowerCase().includes(q));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:w-[90vw] sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col"
        style={{ maxHeight: '85dvh' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search all cards…"
              className="w-full border-2 border-slate-300 rounded-xl px-4 py-2.5 text-base focus:outline-none focus:border-amber-400 bg-slate-50"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 p-1">
            <CloseIcon />
          </button>
        </div>

        <p className="text-xs text-slate-400 px-5 py-2">
          {filtered.length} card{filtered.length !== 1 ? 's' : ''} · tap to add
        </p>

        {/* Grid */}
        <div className="overflow-y-auto flex-1 px-4 pb-6">
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
            {filtered.map(c => (
              <button
                key={c.word}
                onClick={() => { onSelect(c.word, c.category, c.image_url); onClose(); }}
                className="flex flex-col items-center gap-1 p-2 rounded-2xl border-2 border-slate-200 bg-white shadow-sm hover:shadow-md active:scale-95 transition-all"
              >
                <div className={`w-full aspect-square rounded-xl flex items-center justify-center ${CATEGORY_COLORS[c.category] ?? 'bg-slate-100'}`}>
                  <img
                    src={c.image_url}
                    alt={c.word}
                    className="w-10 h-10 object-contain"
                    loading="lazy"
                    draggable={false}
                  />
                </div>
                <span className="text-[10px] sm:text-xs font-bold text-slate-700 text-center line-clamp-2 leading-tight">
                  {c.word}
                </span>
              </button>
            ))}
          </div>

          {filtered.length === 0 && (
            <p className="text-center text-slate-400 italic py-12">No cards match "{query}"</p>
          )}
        </div>
      </div>
    </div>
  );
}
