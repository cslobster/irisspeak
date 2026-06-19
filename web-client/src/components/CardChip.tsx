import type { CardCategory, CardInfo } from '../api/types';

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
  sm: { card: 'w-16 h-20 sm:w-20 sm:h-24',                                img: 'w-8 h-8 sm:w-10 sm:h-10',              label: 'text-[10px] sm:text-xs' },
  md: { card: 'w-[72px] h-24 sm:w-24 sm:h-28',                            img: 'w-10 h-10 sm:w-12 sm:h-12',            label: 'text-xs sm:text-sm' },
  lg: { card: 'w-24 h-28 sm:w-28 sm:h-32 md:w-32 md:h-36',               img: 'w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16', label: 'text-sm md:text-base' },
};

const FALLBACK_SYMBOL: Record<CardCategory, string> = {
  topic:   '🧩',
  action:  '🏃',
  emotion: '🙂',
  core:    '✨',
};

export function CardChip({ card, onClick, size = 'lg', selected = false, disabled = false }: Props) {
  const t = tile[card.category];
  const sz = sizeMap[size];
  const imgSrc = card.corpus_image_url ?? null;
  const displayLabel = card.corpus_name ?? card.label;

  return (
    <button
      onClick={onClick}
      disabled={!onClick || disabled}
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
      <div className={`flex-1 w-full rounded-xl flex items-center justify-center ${t.bg}`}>
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={displayLabel}
            className={`${sz.img} object-contain`}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <span className="text-3xl leading-none" role="img" aria-label={displayLabel}>
            {FALLBACK_SYMBOL[card.category]}
          </span>
        )}
      </div>

      <div className="w-full mt-1.5 px-0.5 text-center leading-tight">
        <div className={`${sz.label} font-bold text-slate-800 line-clamp-2`}>
          {displayLabel}
        </div>
      </div>
    </button>
  );
}
