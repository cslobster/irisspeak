import type { CardCategory, CardInfo } from '../api/types';

// corpus_image_url is an exact 1:1 match to the card's word (see moderator.ts's corpus
// lookup) — safe to render directly. Cards without a match (emotion/core, or a dropped
// hallucination) fall back to just the colored tile + label.
const tile: Record<CardCategory, { bg: string }> = {
  topic:   { bg: 'bg-card-topic' },
  action:  { bg: 'bg-card-action' },
  emotion: { bg: 'bg-card-emotion' },
  core:    { bg: 'bg-card-core' },
};

interface Props {
  card: CardInfo;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  disabled?: boolean;
}

const sizeMap = {
  sm: { card: 'w-16 h-20 sm:w-20 sm:h-24',                label: 'text-[10px] sm:text-xs' },
  md: { card: 'w-[72px] h-24 sm:w-24 sm:h-28',            label: 'text-xs sm:text-sm' },
  lg: { card: 'w-24 h-28 sm:w-28 sm:h-32 md:w-32 md:h-36', label: 'text-sm md:text-base' },
};

export function CardChip({ card, onClick, size = 'lg', selected = false, disabled = false }: Props) {
  const t = tile[card.category];
  const sz = sizeMap[size];
  // Emotion cards show their "I'm X" phrase (label); other categories prefer the corpus's
  // matched word (corpus_name) since that's the word actually confirmed against the vocab.
  const displayLabel = card.category === 'emotion' ? card.label : (card.corpus_name ?? card.label);

  return (
    <button
      onClick={onClick}
      disabled={!onClick || disabled}
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
      className={`
        ${sz.card}
        relative flex flex-col items-center justify-center
        rounded-2xl border-2 border-b-4 border-black ${t.bg}
        shadow-md hover:shadow-lg active:shadow-sm active:translate-y-1 active:scale-95
        transition-all duration-150 ease-out
        select-none cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:translate-y-0
        p-2
        ${selected ? 'ring-4 ring-amber-400' : ''}
      `}
    >
      {card.corpus_image_url && (
        <img
          src={card.corpus_image_url}
          alt=""
          draggable={false}
          className="w-3/4 h-3/4 object-contain mb-1 pointer-events-none select-none"
        />
      )}
      <div className="w-full px-0.5 text-center leading-tight">
        <div className={`${sz.label} font-bold text-slate-800 line-clamp-2`}>
          {displayLabel}
        </div>
      </div>
    </button>
  );
}
