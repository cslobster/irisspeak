import { useState } from 'react';
import type { CardInfo, ChildCardRecommendationResult, DialogueRole } from '../api/types';
import { CardChip } from '../components/CardChip';
import { MenuIcon } from '../components/Icons';
import { SessionMenu, type SettingOption } from '../components/SessionMenu';
import { AskPanel } from '../components/AskPanel';
import { Spinner } from '../components/Spinner';

// Phone layout for the session screen (see SessionScreen: used when the viewport is narrower than 900 px
// or shorter than 600 px). Everything fits the screen without scrolling: portrait shows the cards as a
// 3 x 8 grid (Topic rows 1-3, Action rows 4-5, Feeling row 6, core cards rows 7-8), landscape as 9 x 3 with
// Refresh / Generate / Done as tiles after View all,
// and Transcript / Sound / place / Settings / End are collapsed into one menu button at the bottom left.

export type { SettingOption };

export interface CompactProps {
  landscape: boolean;
  role: DialogueRole; phase: string; phaseLabel: string; started: boolean;
  childRec: ChildCardRecommendationResult | null; interim: CardInfo[];
  parentMessage: string; setParentMessage: (s: string) => void; onSubmit: () => void; onAsk: (text: string) => void;
  isRecording: boolean; partialTranscript: string; onMicTap: () => void;
  lastParentMessage: string | null; bankedChildSentences: string[];
  onCardClick: (c: CardInfo) => void; onCardHold: (c: CardInfo) => void; onRemoveCard: (id: string) => void; onRefresh: () => void; onClear: () => void; onConfirm: () => void;
  busy: boolean; onSearchOpen: () => void; onMoreOpen: () => void; onDone: () => void; doneEnabled: boolean;
  setting: string; settings: SettingOption[]; onSettingChange: (v: string) => void;
  onTranscript: () => void; onEnd: () => void;
  onMenu?: () => void;
}

export function CompactSession(p: CompactProps) {
  const [showSettings, setShowSettings] = useState(false);
  const cur = p.settings.find(s => s.value === p.setting) ?? p.settings[0];

  const childTurn = p.phase === 'idle' && p.role === 'child' && !!p.childRec;
  const banner = p.role === 'child'
    ? (p.lastParentMessage ? `“${p.lastParentMessage}”` : '')
    : p.bankedChildSentences.map(s => `“${s}”`).join('  ');

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#f0ebe1', paddingTop: 'env(safe-area-inset-top)' }}>
      {(banner || (p.landscape && childTurn)) && (
        <div className="flex-shrink-0 px-2 pt-1.5 flex items-center gap-1.5">
          {p.landscape && childTurn && (
            <button onClick={() => setShowSettings(true)} className="icon-btn flex-shrink-0" aria-label="Open menu" style={{ minWidth: 40, minHeight: 32, height: 32, padding: '0 8px' }}>
              <MenuIcon size={20} />
            </button>
          )}
          {banner && (
            <div
              className={`flex-1 min-w-0 px-3 py-1 rounded-xl font-bold text-xs text-center text-slate-700 truncate ${p.role === 'child' ? 'bg-purple-100' : 'bg-[#94c1c2]/15'}`}
              style={{ border: '2px solid #000', borderBottomWidth: 3, boxSizing: 'border-box' }}
            >{banner}</div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col px-2 pt-1.5 pb-1.5 gap-1.5">
        {p.phase !== 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Spinner size={64} />
            <p className="text-sm font-bold text-slate-600 text-center px-4">{p.phaseLabel}</p>
          </div>
        )}

        {p.phase === 'idle' && p.role === 'parent' && p.started && (
          <ParentCompact {...p} icon={cur.icon} onMenu={() => setShowSettings(true)} />
        )}

        {p.phase === 'idle' && p.role === 'child' && p.childRec && (
          <ChildCompact {...p} rec={p.childRec} onMenu={() => setShowSettings(true)} />
        )}
      </div>

      {/* Single menu button, bottom left (on the child's turn it sits in the action row instead) */}
      {!(p.phase === 'idle' && ((p.role === 'child' && p.childRec) || (p.role === 'parent' && p.started))) && (
        <div className="absolute left-3 z-20" style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <MenuButton onClick={() => setShowSettings(true)} />
        </div>
      )}

      {showSettings && (
        <SessionMenu onClose={() => setShowSettings(false)} onTranscript={p.onTranscript} setting={p.setting} settings={p.settings} onSettingChange={p.onSettingChange} onEnd={p.onEnd} />
      )}
    </div>
  );
}

function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="icon-btn p-2.5 active:scale-95 transition-transform" aria-label="Open menu" style={{ minWidth: 44, minHeight: 44 }}>
      <MenuIcon size={22} />
    </button>
  );
}

function ParentCompact(p: CompactProps & { icon: string }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col w-full">
      <AskPanel compact setting={p.setting} onSettingChange={p.onSettingChange} onAsk={p.onAsk}
        parentMessage={p.parentMessage} setParentMessage={p.setParentMessage} onSubmit={p.onSubmit}
        isRecording={p.isRecording} partialTranscript={p.partialTranscript} onMicTap={p.onMicTap}
        leading={<MenuButton onClick={p.onMenu ?? (() => {})} />} />
    </div>
  );
}

function ChildCompact(p: CompactProps & { rec: ChildCardRecommendationResult }) {
  const by: Record<string, CardInfo[]> = { topic: [], action: [], emotion: [], core: [] };
  for (const c of p.rec.cards) (by[c.category] ||= []).push(c);
  // Portrait: 3 columns x 10 rows -- Topic rows 1-3, Action rows 4-5, Feeling row 6, quick row 7-10.
  // Landscape: 8 columns x 4 rows filled in order (topic, action, feeling, quick row); colours mark the type.
  type Cell = CardInfo | 'search' | 'more' | 'refresh' | 'clear' | 'confirm' | 'done' | null;
  const cells: Cell[] = [];
  if (p.landscape) {
    // 8 x 4: topic, action, feeling, the quick row of nine (+ name), View all, then Refresh / Generate / Done as tiles
    cells.push(...pad(by.topic.slice(0, 9), 9), ...pad(by.action.slice(0, 6), 6), ...pad(by.emotion.slice(0, 3), 3), ...pad(by.core.slice(0, 10), 10), 'more', 'search', 'refresh', 'clear', 'confirm', 'done');
  } else {
    // 3 x 10: topic rows 1-3, action 4-5, feeling 6, quick row 7-10 with View all in the last cell
    cells.push(...pad(by.topic.slice(0, 9), 9), ...pad(by.action.slice(0, 6), 6), ...pad(by.emotion.slice(0, 3), 3), ...pad(by.core.slice(0, 10), 10), 'more', 'search');
  }
  return (
    <>
      <div
        className="flex-shrink-0 h-10 bg-amber-50/80 rounded-xl px-2 flex items-center gap-1.5 overflow-x-auto"
        style={{ border: '2px solid #000', borderBottomWidth: 3, boxSizing: 'border-box' }}
      >
        {p.interim.length === 0 ? (
          <p className="italic text-slate-400 text-xs whitespace-nowrap">Tap cards to build your sentence…</p>
        ) : p.interim.map((c, i) => (
          <button
            key={`${c.id}-${i}`}
            onClick={() => p.onRemoveCard(c.id)}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-white border-2 border-b-[3px] border-black rounded-full text-xs font-bold text-slate-700 active:scale-95"
          >{c.corpus_name ?? c.label}<span className="text-[#f09281] text-[10px] font-extrabold">✕</span></button>
        ))}
      </div>

      <div className="relative flex-1 min-h-0">
        {p.busy && (
          <div className="absolute inset-0 z-10 bg-white/60 rounded-xl flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full shadow border"><Spinner size={18} strokeWidth={6} /><span className="text-xs font-bold text-slate-600">Thinking…</span></div>
          </div>
        )}
        <div className={`h-full grid gap-1.5 ${p.landscape ? 'grid-cols-9 grid-rows-4' : 'grid-cols-3 grid-rows-10'}`}>
          {cells.map((c, i) => c === null ? <div key={i} /> : c === 'refresh' || c === 'clear' || c === 'confirm' || c === 'done' ? (
            <ActionTile key={c} kind={c} p={p} />
          ) : c === 'more' ? (
            <button key="more" onClick={p.onMoreOpen} className="min-h-0 w-full h-full flex flex-col items-center justify-center rounded-xl bg-white border-2 border-b-[3px] border-black active:scale-95 select-none">
              <span className="text-2xl leading-none" role="img" aria-label="More ideas">💡</span>
              <span className="text-[11px] font-bold text-slate-500 leading-tight">More ideas</span>
            </button>
          ) : c === 'search' ? (
            <button
              key="search"
              onClick={p.onSearchOpen}
              className="min-h-0 w-full h-full flex flex-col items-center justify-center rounded-xl bg-white border-2 border-b-[3px] border-black active:scale-95 select-none"
            >
              <span className="text-2xl leading-none" role="img" aria-label="Search all words">🔍</span>
              <span className="text-[11px] font-bold text-slate-500 leading-tight">View all</span>
            </button>
          ) : (
            <CardChip key={c.id} card={c} size="fill" onClick={() => !p.busy && p.onCardClick(c)} onLongPress={() => !p.busy && p.onCardHold(c)} />
          ))}
        </div>
      </div>

      {!p.landscape && (
      <div className="flex-shrink-0 flex items-center justify-center gap-2">
        <MenuButton onClick={p.onMenu} />
        <button onClick={p.onRefresh} disabled={p.busy} className="pill-btn bg-slate-500 disabled:opacity-40 text-xs px-3 py-1.5" style={{ minHeight: 40 }}>↻ Refresh</button>
        <button onClick={p.onClear} disabled={p.busy || p.interim.length === 0} className="pill-btn bg-white text-slate-600 border-2 border-slate-400 disabled:opacity-40 text-xs px-3 py-1.5" style={{ minHeight: 40 }}>✕ Clear</button>
        <button onClick={p.onConfirm} disabled={p.interim.length === 0 || p.busy} className="pill-btn bg-[#94c1c2] disabled:opacity-40 text-xs px-4 py-1.5 flex-1 max-w-[220px] whitespace-nowrap" style={{ minHeight: 40 }}>Generate</button>
        <button onClick={p.onDone} disabled={p.busy} className="pill-btn bg-[#f09281] disabled:opacity-40 text-xs px-4 py-1.5" style={{ minHeight: 40 }}>Done</button>
      </div>
      )}
    </>
  );
}

// Refresh / Generate sentence / Done drawn as tiles so they share the grid with the cards (landscape phones).
function ActionTile({ kind, p }: { kind: 'refresh' | 'clear' | 'confirm' | 'done'; p: CompactProps }) {
  const spec = {
    refresh: { label: 'Refresh', icon: '↻', bg: '#64748b', fg: '#fff', onClick: p.onRefresh, disabled: p.busy },
    clear: { label: 'Clear', icon: '✕', bg: '#ffffff', fg: '#475569', onClick: p.onClear, disabled: p.busy || p.interim.length === 0 },
    confirm: { label: 'Generate sentence', icon: '💬', bg: '#94c1c2', fg: '#fff', onClick: p.onConfirm, disabled: p.interim.length === 0 || p.busy },
    done: { label: 'Done', icon: '✓', bg: '#f09281', fg: '#fff', onClick: p.onDone, disabled: p.busy },
  }[kind];
  return (
    <button
      onClick={spec.onClick}
      disabled={spec.disabled}
      className="min-h-0 w-full h-full flex flex-col items-center justify-center rounded-xl border-2 border-b-[3px] border-black active:scale-95 select-none disabled:opacity-40 disabled:active:scale-100"
      style={{ background: spec.bg, color: spec.fg, boxSizing: 'border-box' }}
    >
      <span className="text-xl leading-none">{spec.icon}</span>
      <span className="text-[10px] font-bold leading-tight text-center px-0.5">{spec.label}</span>
    </button>
  );
}

function pad<T>(xs: T[], n: number): (T | null)[] { const out: (T | null)[] = [...xs]; while (out.length < n) out.push(null); return out; }
