import { useEffect, useMemo, useRef, useState } from 'react';
import { getCustomWords } from '../engine/store';
import { CloseIcon } from './Icons';
import { labelSizeClass } from '../labelSize';

interface CboardCard {
  word: string;
  image_url: string | null;
  emoji?: string;          // vocabulary words without a symbol picture
  category: string;
}

interface FolderCard {
  folder: string;
  word: string;
  image_url: string | null;
  emoji?: string;
}

let _cache: CboardCard[] | null = null;
let _folderCache: FolderCard[] | null = null;

async function loadCards(): Promise<CboardCard[]> {
  if (_cache) return _cache;
  const r = await fetch('/cboard_cards.json', { cache: 'no-cache' });
  _cache = await r.json();
  return _cache!;
}

async function loadFolders(): Promise<FolderCard[]> {
  if (_folderCache) return _folderCache;
  const r = await fetch('/cboard_folders.json', { cache: 'no-cache' });
  _folderCache = await r.json();
  return _folderCache!;
}

interface Props {
  onSelect: (word: string, category: string, image_url: string | null) => void;
  onClose: () => void;
  // Opens the folder-browse view scoped directly into this path (e.g. ['numbers']) instead
  // of the root — used when a folder card (e.g. "Numbers") is tapped from the session screen.
  initialPath?: string[];
  /** Extra folder rows supplied by the session (the "More ideas" page of next suggestions). */
  extraRows?: FolderCard[];
}

const CATEGORY_COLORS: Record<string, string> = {
  topic:   'bg-card-topic',
  action:  'bg-card-action',
  emotion: 'bg-card-emotion',
  core:    'bg-card-core',
};

// Real Cboard category icons (from app.cboard.io's own root board), used for top-level
// folders. Deeper sub-folders (e.g. animals > birds) don't have a dedicated Cboard icon, so
// those fall back to their first word's image as a cover, like an album using its first photo.
const FOLDER_ICONS: Record<string, string> = {
  actions: '/symbols/openmoji/actions.svg',
  activities: '/symbols/openmoji/activities.svg',
  animals: '/symbols/openmoji/animals.svg',
  body: '/symbols/mulberry/body_outline.svg',
  clothing: '/symbols/mulberry/generic_clothes.svg',
  describe: '/symbols/mulberry/shapesorter.svg',
  drinks: '/symbols/mulberry/drinks.svg',
  emotions: '/symbols/openmoji/emotions.svg',
  food: '/symbols/mulberry/food.svg',
  furniture: '/symbols/mulberry/furniture.svg',
  hygiene: '/symbols/openmoji/hygiene.svg',
  kitchen: '/symbols/openmoji/kitchen.svg',
  numbers: '/symbols/mulberry/count_,_to.svg',
  people: '/symbols/openmoji/people.svg',
  places: '/symbols/mulberry/globe.svg',
  plants: '/symbols/mulberry/plant.svg',
  position: '/symbols/mulberry/where.svg',
  questions: '/symbols/mulberry/ask_,_to.svg',
  'quick chat': '/symbols/openmoji/speech_bubble.svg',
  school: '/symbols/mulberry/school.svg',
  snacks: '/symbols/mulberry/jelly_beans.svg',
  sports: '/symbols/mulberry/football.svg',
  technology: '/symbols/mulberry/technology.svg',
  time: '/symbols/mulberry/clock.svg',
  toys: '/symbols/mulberry/toys.svg',
  transport: '/symbols/mulberry/travel.svg',
  weather: '/symbols/openmoji/weather.svg',
};

export function CardSearchOverlay({ onSelect, onClose, initialPath, extraRows }: Props) {
  const [query, setQuery] = useState('');
  const [allCards, setAllCards] = useState<CboardCard[]>([]);
  const [folderCards, setFolderCards] = useState<FolderCard[]>([]);
  const [path, setPath] = useState<string[]>(initialPath ?? []);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCards().then(setAllCards);
    loadFolders().then(rows => {
      setFolderCards(rows);
      // "View all" lands on the first folder (the first icon of the root grid), not on an empty search.
      if (!initialPath) {
        const first = [...new Set(rows.filter(r => r.folder !== 'Root').map(r => r.folder.split(' > ')[0]))].sort((a, b) => a.localeCompare(b))[0];
        if (first) setPath([first]);
      }
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Categories aren't in the folder hierarchy data, so look them up by word from the
  // existing flat dataset -- keeps folder-view tile tinting consistent with search results.
  const categoryByWord = useMemo(() => {
    const map = new Map<string, string>();
    allCards.forEach(c => map.set(c.word, c.category));
    return map;
  }, [allCards]);

  const q = query.toLowerCase().trim();
  const isSearching = q.length > 0;
  const custom: CboardCard[] = getCustomWords().map(w => ({ word: w.word, image_url: w.image_url, emoji: w.emoji ?? (w.favourite ? '⭐' : '💬'), category: w.category }));
  const searchResults = isSearching ? [...custom.filter(c => c.word.toLowerCase().includes(q) && !allCards.some(a => a.word.toLowerCase() === c.word.toLowerCase())), ...allCards.filter(c => c.word.toLowerCase().includes(q))] : [];

  // Folder rows are tagged with their full path, e.g. "animals > birds". At the current
  // `path`, a row is either a direct word here (its path matches exactly) or belongs to a
  // subfolder one level deeper (its path starts with ours plus one more segment). Each
  // subfolder also picks up the first word encountered under it as a cover image, since
  // there's no dedicated folder-icon asset in the corpus -- same idea as an album using its
  // first photo as a thumbnail.
  const { subfolders, wordsHere } = useMemo(() => {
    const seenSubfolders = new Set<string>();
    const order: string[] = [];
    const covers = new Map<string, string>();
    const here: FolderCard[] = [];
    for (const row of [...(extraRows ?? []), ...folderCards]) {
      if (row.folder === 'Root') continue; // just yes/no, redundant with the always-on core cards
      const segs = row.folder.split(' > ');
      const matchesPrefix = path.every((p, i) => segs[i] === p);
      if (!matchesPrefix) continue;
      if (segs.length === path.length) {
        here.push(row);
      } else if (segs.length > path.length) {
        const next = segs[path.length];
        if (!seenSubfolders.has(next)) { seenSubfolders.add(next); order.push(next); covers.set(next, FOLDER_ICONS[next] ?? row.image_url); }
      }
    }
    order.sort((a, b) => a.localeCompare(b));
    return { subfolders: order.map(name => ({ name, cover: covers.get(name)! })), wordsHere: here };
  }, [folderCards, path, extraRows]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:w-[90vw] sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col"
        style={{ height: '85dvh' }}
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

        {isSearching ? (
          <>
            <p className="text-xs text-slate-400 px-5 py-2">
              {searchResults.length} card{searchResults.length !== 1 ? 's' : ''} · tap to add
            </p>
            <div className="overflow-y-auto flex-1 px-4 pb-6">
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                {searchResults.map(c => (
                  <button
                    key={c.word}
                    onClick={() => { onSelect(c.word, c.category, c.image_url); onClose(); }}
                    className={`aspect-square overflow-hidden flex flex-col items-center justify-center rounded-2xl border-2 border-slate-200 ${CATEGORY_COLORS[c.category] ?? 'bg-slate-100'} shadow-sm hover:shadow-md active:scale-95 transition-all p-2`}
                  >
                    {c.image_url ? <img src={c.image_url} alt="" className="w-1/2 h-1/2 object-contain mb-1" loading="lazy" draggable={false} />
                      : <span className="w-1/2 h-1/2 flex items-center justify-center text-3xl mb-1" aria-hidden="true">{c.emoji ?? '💬'}</span>}
                    <span className={`${labelSizeClass(c.word)} font-bold text-slate-800 text-center line-clamp-2 leading-tight`}>
                      {c.word}
                    </span>
                  </button>
                ))}
              </div>
              {searchResults.length === 0 && (
                <p className="text-center text-slate-400 italic py-12">No cards match "{query}"</p>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1 px-5 py-2 text-sm font-bold text-slate-500 flex-wrap">
              <button onClick={() => setPath([])} className={path.length === 0 ? 'text-slate-800' : 'hover:text-slate-700'}>
                📁 Folders
              </button>
              {path.map((seg, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-slate-300">/</span>
                  <button
                    onClick={() => setPath(path.slice(0, i + 1))}
                    className={i === path.length - 1 ? 'text-slate-800' : 'hover:text-slate-700'}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 px-4 pb-6">
              {subfolders.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-4">
                  {subfolders.map(({ name, cover }) => (
                    <button
                      key={name}
                      onClick={() => setPath([...path, name])}
                      className="aspect-square overflow-hidden flex flex-col items-center justify-center rounded-2xl border-2 border-slate-200 bg-card-topic shadow-sm hover:shadow-md active:scale-95 transition-all p-2"
                    >
                      <img src={cover} alt="" className="w-3/5 h-3/5 object-contain mb-1" loading="lazy" draggable={false} />
                      <span className={`${labelSizeClass(name)} font-bold text-slate-800 text-center capitalize line-clamp-2 leading-tight`}>
                        {name}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {wordsHere.length > 0 && (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                  {wordsHere.map(c => {
                    const category = categoryByWord.get(c.word) ?? 'topic';
                    return (
                      <button
                        key={c.word}
                        onClick={() => { onSelect(c.word, category, c.image_url); onClose(); }}
                        className={`aspect-square overflow-hidden flex flex-col items-center justify-center rounded-2xl border-2 border-slate-200 ${CATEGORY_COLORS[category] ?? 'bg-slate-100'} shadow-sm hover:shadow-md active:scale-95 transition-all p-2`}
                      >
                        {c.image_url ? <img src={c.image_url} alt="" className="w-1/2 h-1/2 object-contain mb-1" loading="lazy" draggable={false} />
                          : <span className="w-1/2 h-1/2 flex items-center justify-center text-3xl mb-1" aria-hidden="true">{c.emoji ?? '💬'}</span>}
                        <span className={`${labelSizeClass(c.word)} font-bold text-slate-800 text-center line-clamp-2 leading-tight`}>
                          {c.word}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {subfolders.length === 0 && wordsHere.length === 0 && (
                <p className="text-center text-slate-400 italic py-12">This folder is empty.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
