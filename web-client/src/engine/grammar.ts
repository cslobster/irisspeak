// Word forms for tap-and-hold on a card: plural, past, -ing, third person, possessive. Rule-based English
// with the irregulars a child meets most; the result becomes a free card that keeps the base card's picture.

export type WordForm = 'plural' | 'past' | 'ing' | 'third' | 'possessive';
export const FORM_LABELS: Record<WordForm, string> = { plural: 'more than one', past: 'already happened', ing: 'doing it now', third: 'he / she does', possessive: "belongs to" };

const IRREGULAR_PAST: Record<string, string> = {
  go: 'went', eat: 'ate', drink: 'drank', see: 'saw', come: 'came', run: 'ran', sit: 'sat', sleep: 'slept', get: 'got', give: 'gave', have: 'had', make: 'made',
  take: 'took', read: 'read', write: 'wrote', draw: 'drew', swim: 'swam', sing: 'sang', ride: 'rode', fall: 'fell', feel: 'felt', find: 'found', hurt: 'hurt',
  buy: 'bought', bring: 'brought', think: 'thought', say: 'said', tell: 'told', do: 'did', put: 'put', cut: 'cut', hit: 'hit', win: 'won', lose: 'lost',
  build: 'built', break: 'broke', wear: 'wore', throw: 'threw', catch: 'caught', hold: 'held', hear: 'heard', know: 'knew', leave: 'left', meet: 'met',
  forget: 'forgot', begin: 'began', fly: 'flew', grow: 'grew', hide: 'hid', keep: 'kept', let: 'let', lie: 'lay', pay: 'paid', send: 'sent', shake: 'shook',
  speak: 'spoke', stand: 'stood', teach: 'taught', wake: 'woke', is: 'was', are: 'were', am: 'was', can: 'could', will: 'would', want: 'wanted', like: 'liked',
};
const IRREGULAR_PLURAL: Record<string, string> = {
  child: 'children', foot: 'feet', tooth: 'teeth', mouse: 'mice', man: 'men', woman: 'women', person: 'people', fish: 'fish', sheep: 'sheep', deer: 'deer',
  goose: 'geese', leaf: 'leaves', knife: 'knives', life: 'lives', wolf: 'wolves', potato: 'potatoes', tomato: 'tomatoes', hero: 'heroes', mum: 'mums', mom: 'moms',
};
const IRREGULAR_THIRD: Record<string, string> = { have: 'has', do: 'does', go: 'goes', be: 'is', am: 'is', are: 'is', can: 'can', will: 'will', say: 'says' };
const IRREGULAR_ING: Record<string, string> = { lie: 'lying', die: 'dying', tie: 'tying', be: 'being', see: 'seeing', is: 'being', are: 'being', am: 'being' };
const NO_DOUBLE = new Set(['open', 'listen', 'visit', 'happen', 'enter', 'offer', 'order', 'answer', 'water', 'color', 'colour', 'wonder', 'remember', 'travel', 'cancel']);
const VOWELS = 'aeiou';

function cvc(w: string) {   // consonant-vowel-consonant ending: doubles the last letter (run -> running, hug -> hugged)
  if (w.length < 3 || NO_DOUBLE.has(w)) return false;
  const a = w[w.length - 3], b = w[w.length - 2], c = w[w.length - 1];
  return !VOWELS.includes(a) && VOWELS.includes(b) && !VOWELS.includes(c) && !'wxy'.includes(c) && w.length <= 5;
}
function capitalised(base: string, out: string) { return base[0] === base[0].toUpperCase() && base[0] !== base[0].toLowerCase() ? out[0].toUpperCase() + out.slice(1) : out; }

/** The inflected form of a card's word, or null when the form makes no sense (phrases, numbers, pronouns). */
export function inflect(word: string, form: WordForm): string | null {
  const w = word.trim(); if (!w || /\d/.test(w) || w.includes("'") || w.split(' ').length > 2) return null;
  const parts = w.split(' '); const head = parts.length === 2 ? parts[1] : parts[0]; const prefix = parts.length === 2 ? parts[0] + ' ' : '';
  const lw = head.toLowerCase(); let out: string | null = null;
  switch (form) {
    case 'plural':
      if (IRREGULAR_PLURAL[lw]) out = IRREGULAR_PLURAL[lw];
      else if (/(s|x|z|ch|sh)$/.test(lw)) out = lw + 'es';
      else if (/[^aeiou]y$/.test(lw)) out = lw.slice(0, -1) + 'ies';
      else out = lw + 's';
      break;
    case 'past':
      if (IRREGULAR_PAST[lw]) out = IRREGULAR_PAST[lw];
      else if (lw.endsWith('e')) out = lw + 'd';
      else if (/[^aeiou]y$/.test(lw)) out = lw.slice(0, -1) + 'ied';
      else if (cvc(lw)) out = lw + lw[lw.length - 1] + 'ed';
      else out = lw + 'ed';
      break;
    case 'ing':
      if (IRREGULAR_ING[lw]) out = IRREGULAR_ING[lw];
      else if (lw.endsWith('ie')) out = lw.slice(0, -2) + 'ying';
      else if (lw.endsWith('e') && !lw.endsWith('ee') && lw !== 'be') out = lw.slice(0, -1) + 'ing';
      else if (cvc(lw)) out = lw + lw[lw.length - 1] + 'ing';
      else out = lw + 'ing';
      break;
    case 'third':
      if (IRREGULAR_THIRD[lw]) out = IRREGULAR_THIRD[lw];
      else if (/(s|x|z|ch|sh|o)$/.test(lw)) out = lw + 'es';
      else if (/[^aeiou]y$/.test(lw)) out = lw.slice(0, -1) + 'ies';
      else out = lw + 's';
      break;
    case 'possessive':
      out = lw.endsWith('s') ? lw + "'" : lw + "'s";
      break;
  }
  if (!out || out === lw) return null;
  return prefix + capitalised(head, out);
}

/** Forms worth offering for a card, by its vocabulary category. */
export function formsFor(category: string): WordForm[] {
  if (['actions', 'activities', 'play'].includes(category)) return ['past', 'ing', 'third'];
  if (['people', 'animals', 'family'].includes(category)) return ['plural', 'possessive'];
  if (['feelings', 'describing', 'colours', 'core', 'phrases', 'questions', 'numbers', 'quantity', 'time'].includes(category)) return [];
  return ['plural', 'possessive'];
}
