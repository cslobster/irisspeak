// Shrinks a card/tile label's font size as the word/phrase gets longer, so things like
// "spaghetti bolognaise" or "Quick Chat" fit within a fixed-size tile instead of wrapping
// past 2 lines or getting clipped. Tiers are deliberately coarse (length buckets, not a
// continuous scale) to keep sizing predictable and match the app's existing discrete
// size-tier convention (see CardChip's sizeMap).
const TIERS: Record<'sm' | 'md' | 'lg', [normal: string, long: string, longer: string]> = {
  sm: ['text-[10px] sm:text-xs', 'text-[9px] sm:text-[10px]', 'text-[8px] sm:text-[9px]'],
  md: ['text-xs sm:text-sm', 'text-[10px] sm:text-xs', 'text-[9px] sm:text-[10px]'],
  lg: ['text-sm md:text-base', 'text-xs sm:text-sm', 'text-[10px] sm:text-xs'],
};

export function labelSizeClass(text: string, base: 'sm' | 'md' | 'lg' = 'sm'): string {
  const [normal, long, longer] = TIERS[base];
  if (text.length > 14) return longer;
  if (text.length > 8) return long;
  return normal;
}
