import type { CardCategory, CardInfo } from '../api/types';
import { emojiForCard } from '../cardEmoji';

const tile: Record<CardCategory, { bg: string; ring: string }> = {
  topic:   { bg: 'bg-card-topic',   ring: 'ring-sky-200' },
  action:  { bg: 'bg-card-action',  ring: 'ring-orange-200' },
  emotion: { bg: 'bg-card-emotion', ring: 'ring-rose-200' },
  core:    { bg: 'bg-card-core',    ring: 'ring-cyan-200' },
};

interface Props {
  card: CardInfo;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  disabled?: boolean;
}

const sizeMap = {
  sm: { card: 'w-16 h-20 sm:w-20 sm:h-24',                                 emoji: 'text-2xl sm:text-3xl',           label: 'text-[10px] sm:text-xs', sub: 'text-[9px]' },
  md: { card: 'w-[72px] h-24 sm:w-24 sm:h-28',                             emoji: 'text-3xl sm:text-4xl',           label: 'text-xs sm:text-sm',     sub: 'text-[9px] sm:text-[10px]' },
  lg: { card: 'w-24 h-28 sm:w-28 sm:h-32 md:w-32 md:h-36',                 emoji: 'text-4xl sm:text-5xl md:text-6xl', label: 'text-sm md:text-base',   sub: 'text-[10px]' },
};

const modeBadge: Record<NonNullable<CardInfo['corpus_mode']>, { color: string; title: string }> = {
  exact: { color: 'bg-emerald-100 text-emerald-700', title: 'exact corpus match' },
  word:  { color: 'bg-amber-100   text-amber-700',   title: 'word-boundary match' },
  cos:   { color: 'bg-slate-100   text-slate-600',   title: 'closest semantic neighbor' },
};

export function CardChip({ card, onClick, size = 'lg', selected = false, disabled = false }: Props) {
  const t = tile[card.category];
  const sz = sizeMap[size];
  const emoji = emojiForCard(card.label, card.category);

  // Show corpus_name as a subtitle when it differs from the LLM label.
  const showCorpusSub =
    card.corpus_name &&
    card.corpus_name.toLowerCase() !== card.label.toLowerCase();

  return (
    <button
      onClick={onClick}
      disabled={!onClick || disabled}
      title={
        card.corpus_name
          ? `${card.category} · corpus: ${card.corpus_name} (${card.corpus_mode}, cos=${card.corpus_cosine?.toFixed(2)})`
          : card.category
      }
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
      className={`
        ${sz.card}
        relative flex flex-col items-center justify-between
        rounded-2xl bg-white border-2 border-slate-200
        shadow-md hover:shadow-lg active:shadow-sm active:translate-y-1 active:scale-95
        transition-all duration-150 ease-out
        select-none cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:translate-y-0
        p-2 pt-1.5 pb-1.5
        ${selected ? 'ring-4 ring-amber-400' : ''}
      `}
    >
      {/* Match-mode badge in top-right corner */}
      {card.corpus_mode && (
        <span
          className={`absolute top-1 right-1 px-1 py-0 rounded-full ${sz.sub} font-bold ${modeBadge[card.corpus_mode].color}`}
          title={modeBadge[card.corpus_mode].title}
        >
          {card.corpus_mode}
        </span>
      )}

      <div className={`flex-1 w-full rounded-xl flex items-center justify-center ${t.bg}`}>
        <span className={`${sz.emoji} leading-none drop-shadow-sm`} role="img" aria-label={card.label}>
          {emoji}
        </span>
      </div>

      <div className="w-full mt-1.5 px-0.5 text-center leading-tight">
        {/* Primary = matched corpus card name (the searched word), falls back to LLM label. */}
        <div className={`${sz.label} font-bold text-slate-800 line-clamp-2`}>
          {card.corpus_name ?? card.label}
        </div>
        {/* Secondary = the original Gemini word, only when it's different from the corpus match. */}
        {showCorpusSub && (
          <div className={`${sz.sub} text-slate-500 italic line-clamp-1 mt-0.5`} title={`Gemini said: ${card.label}`}>
            gemini: {card.label}
          </div>
        )}
      </div>
    </button>
  );
}
