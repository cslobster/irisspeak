import { useMemo } from 'react';
import { CardChip } from '../../components/CardChip';
import { ReportButton } from '../../components/ReportButton';
import { Spinner } from '../../components/Spinner';
import type { CardInfo, ChildCardRecommendationResult } from '../../api/types';
import { ACTION_COL_W } from './layout';

interface ChildTurnProps {
  rec: ChildCardRecommendationResult;
  interim: CardInfo[];
  onCardClick: (c: CardInfo) => void;
  onCardHold: (c: CardInfo) => void;
  onRemoveCard: (cardId: string) => void;
  onRefresh: () => void;
  onClear: () => void;
  onConfirm: () => void;
  busy: boolean;
  onSearchOpen: () => void;
  onMoreOpen: () => void;
  onDone: () => void;
  onFeedback: () => void;
  sideActions?: boolean;   // short landscape (iPad Safari with tabs): action buttons in a column on the right
  doneEnabled: boolean;
}

export function ChildTurn({ rec, interim, onCardClick, onCardHold, onRemoveCard, onRefresh, onClear, onConfirm, busy, onSearchOpen, onMoreOpen, onDone, doneEnabled, onFeedback, sideActions = false }: ChildTurnProps) {
  const byCat = useMemo(() => {
    const groups: Record<CardInfo['category'], CardInfo[]> = { topic: [], action: [], emotion: [], core: [] };
    for (const c of rec.cards) (groups[c.category] ||= []).push(c);
    return groups;
  }, [rec]);

  // Topic 5 columns, Action 1, Feeling 1 -- three rows each: 15 / 3 / 3 (PANEL_BIG in api/local.ts; phones use CompactSession).
  const mainCats: Array<{ key: 'topic' | 'action' | 'emotion'; label: string; tint: string; n: number }> = [
    { key: 'topic',   label: 'Topic',   tint: 'bg-card-topic/40',   n: 5 },
    { key: 'action',  label: 'Action',  tint: 'bg-card-action/40',  n: 1 },
    { key: 'emotion', label: 'Feeling', tint: 'bg-card-emotion/40', n: 1 },
  ];

  return (
    <div className={`flex-1 min-h-0 flex ${sideActions ? 'flex-row items-stretch gap-3' : 'flex-col items-stretch gap-2'}`}>
    <div className="flex-1 min-h-0 min-w-0 flex flex-col items-stretch gap-2">

      {/* Selected-card deck -- fixed height, horizontal scroll, text pills */}
      <div
        className="flex-shrink-0 h-[84px] bg-amber-50/80 rounded-2xl px-3 py-2 shadow-sm flex items-center gap-3"
        style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
      >
       <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700 leading-none flex-shrink-0">
          Your selection {interim.length > 0 && <span className="font-normal normal-case">(tap to remove)</span>}
        </span>
        {interim.length === 0 ? (
          <p className="italic text-slate-400 text-xs">Tap cards below to build your sentence…</p>
        ) : (
          <div className="flex gap-2 items-center overflow-x-auto">
            {interim.map((c, i) => (
              <button
                key={`${c.id}-${i}`}
                onClick={() => onRemoveCard(c.id)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-b-4 border-black rounded-full text-sm font-bold text-slate-700 active:scale-95 transition-transform"
                style={{ touchAction: 'manipulation' }}
              >
                {c.corpus_name ?? c.label}
                <span className="text-[#f09281] text-[11px] font-extrabold">✕</span>
              </button>
            ))}
          </div>
        )}
       </div>
        {/* Say it: right where the chosen words are, not down in the action bar */}
        <button
          onClick={onConfirm}
          disabled={interim.length === 0 || busy}
          className="pill-btn bg-[#94c1c2] disabled:opacity-40 text-sm sm:text-base px-5 sm:px-8 py-2.5 shadow-lg shrink-0"
          title="Turn the chosen cards into a sentence"
        >Speak</button>
      </div>

      {/* Main: 3 category panels side-by-side, widths 3 : 2 : 1 */}
      <div className="relative flex-shrink-0">
        {busy && (
          <div className="absolute inset-0 z-10 bg-white/70 backdrop-blur-[1px] rounded-2xl flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow border">
              <Spinner size={20} strokeWidth={6} />
              <span className="text-sm font-bold text-slate-600">Thinking…</span>
            </div>
          </div>
        )}
        {/* the three panels span the content width: Action and Feeling hug their column, Topic takes the rest */}
        <div className="flex items-stretch gap-1.5 sm:gap-2">
          {mainCats.map(({ key, label, tint, n }) => (
            <div
              key={key}
              className={`${tint} ${n > 1 ? 'flex-1 min-w-0' : 'flex-none'} rounded-2xl p-1.5 sm:p-2 flex flex-col`}
              style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
            >
              <p className="text-center text-sm sm:text-base font-extrabold text-slate-700 mb-1 flex-shrink-0">{label}</p>
              {/* yesterday's card size (the large chip), five to a row, packed at the quick row's gap and centred */}
              <div className={`grid gap-2 sm:gap-3 content-start ${n > 1 ? 'justify-between' : 'justify-center'}`} style={{ gridTemplateColumns: `repeat(${n}, max-content)` }}>
                {byCat[key].map(c => (
                  <CardChip key={c.id} card={c} size="lg" onClick={() => !busy && onCardClick(c)} onLongPress={() => !busy && onCardHold(c)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: the quick row -- Yes / No / Please, five personal cards, the child's name card -- then More ideas and View all, one row;
          the action bar sits directly under it (same group), pinned to the bottom of the board column */}
      <div className="flex-shrink-0 flex flex-col gap-1.5">
      <div className="flex-shrink-0 flex justify-center gap-2 sm:gap-3 flex-nowrap">
        {byCat.core.map(c => (
          <div key={c.id} className="shrink-0">
            <CardChip card={c} size="md" onClick={() => !busy && onCardClick(c)} />
          </div>
        ))}
        <div className="shrink-0">
          <button
            onClick={onMoreOpen}
            style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
            className="w-[72px] h-24 sm:w-24 sm:h-28 flex flex-col items-center justify-between rounded-2xl bg-white border-2 border-b-4 border-black hover:shadow-md active:scale-95 transition-all duration-150 p-2 pt-1.5 pb-1.5 select-none"
          >
            <div className="flex-1 w-full rounded-xl flex items-center justify-center bg-amber-50">
              <span className="text-3xl leading-none" role="img" aria-label="More ideas">💡</span>
            </div>
            <div className="w-full mt-1.5 px-0.5 text-center leading-tight">
              <div className="text-xs sm:text-sm font-bold text-slate-500 line-clamp-2">More ideas</div>
            </div>
          </button>
        </div>
        <div className="shrink-0">
          <button
            onClick={onSearchOpen}
            style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
            className="w-[72px] h-24 sm:w-24 sm:h-28 flex flex-col items-center justify-between rounded-2xl bg-white border-2 border-b-4 border-black hover:shadow-md active:scale-95 transition-all duration-150 p-2 pt-1.5 pb-1.5 select-none cursor-pointer"
          >
            <div className="flex-1 w-full rounded-xl flex items-center justify-center bg-slate-100">
              <span className="text-3xl leading-none" role="img" aria-label="Search all words">🔍</span>
            </div>
            <div className="w-full mt-1.5 px-0.5 text-center leading-tight">
              <div className="text-xs sm:text-sm font-bold text-slate-500 line-clamp-2">View all words</div>
            </div>
          </button>
        </div>
      </div>

      {!sideActions && (
        <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3 pb-1">
          <div className="flex-1" />
          <ActionTile label="Refresh" icon="↻" tint="bg-slate-200" onClick={onRefresh} disabled={busy} />
          <ActionTile label="Clear" icon="✕" tint="bg-white" onClick={onClear} disabled={busy || interim.length === 0} />
          <ActionTile label="Done" icon="✓" tint="bg-[#f09281]" onClick={onDone} disabled={busy} />
          <div className="flex-1 flex justify-end gap-2 sm:gap-3">
            <ActionTile label="Feedback" icon="💬" tint="bg-white" onClick={onFeedback} disabled={busy} title="Tell us when the board misses" />
            <ReportButton />
          </div>
        </div>
      )}
      </div>
      </div>

      {/* Short landscape (iPad Safari with tabs): the same four buttons as a column on the right of the board */}
      {sideActions && (
      <div className="flex-shrink-0 flex flex-col justify-start items-center gap-2 sm:gap-3 pt-1" style={{ width: ACTION_COL_W }}>
        <ActionTile label="Refresh" icon="↻" tint="bg-slate-200" onClick={onRefresh} disabled={busy} />
        <ActionTile label="Clear" icon="✕" tint="bg-white" onClick={onClear} disabled={busy || interim.length === 0} />
        <ActionTile label="Done" icon="✓" tint="bg-[#f09281]" onClick={onDone} disabled={busy} />
        <div className="mt-2 flex flex-col gap-2 sm:gap-3">
          <ActionTile label="Feedback" icon="💬" tint="bg-white" onClick={onFeedback} disabled={busy} title="Tell us when the board misses" />
          <ReportButton />
        </div>
      </div>
      )}
    </div>
  );
}

/** Refresh / Clear / Done / Feedback as cards: the quick-row chip's size and border, so the whole bottom of the board
 *  is one family of tiles. */
function ActionTile({ label, icon, tint, onClick, disabled, title }: { label: string; icon: string; tint: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
      className={`w-[72px] h-24 sm:w-24 sm:h-28 flex flex-col items-center justify-between rounded-2xl ${tint} border-2 border-b-4 border-black hover:shadow-md active:scale-95 transition-all duration-150 px-1 pt-1.5 pb-1.5 select-none disabled:opacity-40 disabled:active:scale-100`}
    >
      <div className="flex-1 w-full rounded-xl flex items-center justify-center">
        <span className="text-3xl leading-none" aria-hidden="true">{icon}</span>
      </div>
      <div className="text-xs sm:text-sm font-bold text-slate-700 line-clamp-2">{label}</div>
    </button>
  );
}
