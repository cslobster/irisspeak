import type { CardCategory, CardInfo } from '../api/types';
import { labelSizeClass } from '../labelSize';

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
  sm: { card: 'w-16 h-20 sm:w-20 sm:h-24' },
  md: { card: 'w-[72px] h-24 sm:w-24 sm:h-28' },
  lg: { card: 'w-24 h-28 sm:w-28 sm:h-32 md:w-32 md:h-36' },
};

export function CardChip({ card, onClick, size = 'lg', selected = false, disabled = false }: Props) {
  const t = tile[card.category];
  const sz = sizeMap[size];
  // Emotion cards show their "I'm X" phrase (label); other categories prefer the corpus's
  // matched word (corpus_name) since that's the word actually confirmed against the vocab.
  const displayLabel = card.category === 'emotion' ? card.label : (card.corpus_name ?? card.label);
  // Longer words/phrases (e.g. "spaghetti bolognaise") shrink to fit instead of clipping.
  const labelClass = labelSizeClass(displayLabel, size);

  // Folder cards keep their category's Fitzgerald-Key fill color (that color-to-word-type
  // mapping is itself an accessibility convention — changing it would cost more than it gains)
  // but need to read as visibly different at a glance, from across a row of 4 tiles, without
  // relying on text. Three redundant, literal cues instead of one subtle one: a stack of card
  // edges peeking out behind (the concrete "there's more behind this" metaphor), a bold
  // non-black border color used nowhere else in the deck, and a solid high-contrast badge
  // (replacing the old small dog-ear, which testing-in-practice showed wasn't noticeable
  // enough — see CONTEXT.md's Folder Card entry). No motion/animation, since that can be
  // over-stimulating rather than clarifying.
  const folderAccent = '#6D5BD0';

  return (
    <div className={`relative ${sz.card}`}>
      {card.is_folder && (
        <>
          <div
            className="absolute inset-0 rounded-2xl border-2 bg-white translate-x-2 translate-y-2"
            style={{ borderColor: folderAccent }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 rounded-2xl border-2 bg-white translate-x-1 translate-y-1"
            style={{ borderColor: folderAccent }}
            aria-hidden="true"
          />
        </>
      )}
      <button
        onClick={onClick}
        disabled={!onClick || disabled}
        style={{
          touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none',
          ...(card.is_folder ? { borderColor: folderAccent, borderBottomColor: folderAccent } : {}),
        }}
        className={`
          ${sz.card}
          relative flex flex-col items-center justify-center
          rounded-2xl border-2 border-b-4 ${card.is_folder ? '' : 'border-black'} ${t.bg}
          shadow-md hover:shadow-lg active:shadow-sm active:translate-y-1 active:scale-95
          transition-all duration-150 ease-out
          select-none cursor-pointer
          disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:translate-y-0
          p-2
          ${selected ? 'ring-4 ring-amber-400' : ''}
        `}
      >
      {card.is_folder && (
        <div
          className="absolute -top-2.5 -right-2.5 w-8 h-8 rounded-full flex items-center justify-center border-2 border-black shadow-md"
          style={{ background: folderAccent }}
          aria-hidden="true"
        >
          <span className="text-base leading-none">📂</span>
        </div>
      )}
      {card.corpus_image_url ? (
        <img
          src={card.corpus_image_url}
          alt=""
          draggable={false}
          className="w-3/4 h-3/4 object-contain mb-1 pointer-events-none select-none"
        />
      ) : card.emoji ? (
        // Custom Vocabulary Word using the emoji fallback (no corpus image, no parent
        // upload) — an emoji character isn't a valid <img src>, so it renders as text.
        <span className="text-4xl mb-1 pointer-events-none select-none" aria-hidden="true">
          {card.emoji}
        </span>
      ) : null}
      <div className="w-full px-0.5 text-center leading-tight">
        <div className={`${labelClass} font-bold text-slate-800 line-clamp-2`}>
          {displayLabel}
        </div>
      </div>
      </button>
    </div>
  );
}
