// Per-label emoji map. Real PNG corpus isn't bundled, so we render an emoji at
// the same slot the original RN client put a stock illustration into.
// Keys are lowercased; we try exact, then prefix/word match, then category fallback.

import type { CardCategory } from './api/types';

const TOPIC: Record<string, string> = {
  school: '🏫', kinder: '🏫', kindergarten: '🏫', class: '🏫', classroom: '🏫', daycare: '🏫',
  home: '🏠', house: '🏠', room: '🛏️', bedroom: '🛏️', kitchen: '🍳', bathroom: '🛁',
  friend: '👫', friends: '👫', teacher: '👩‍🏫', mom: '👩', dad: '👨', mother: '👩', father: '👨',
  brother: '👦', sister: '👧', baby: '👶', grandma: '👵', grandpa: '👴',
  family: '👨‍👩‍👧', people: '👥', boy: '👦', girl: '👧',
  food: '🍽️', breakfast: '🥣', lunch: '🍱', dinner: '🍽️', snack: '🍪',
  pizza: '🍕', burger: '🍔', sandwich: '🥪', noodle: '🍜', noodles: '🍜', rice: '🍚',
  fruit: '🍎', apple: '🍎', banana: '🍌', orange: '🍊', strawberry: '🍓',
  vegetable: '🥦', water: '💧', milk: '🥛', juice: '🧃', tea: '🍵',
  cake: '🍰', icecream: '🍦', candy: '🍬', chocolate: '🍫',
  toy: '🧸', toys: '🧸', lego: '🧱', doll: '🪆', ball: '⚽', game: '🎮', games: '🎮',
  book: '📚', books: '📚', story: '📖', music: '🎵', song: '🎶', art: '🎨', painting: '🖼️',
  car: '🚗', bus: '🚌', train: '🚆', bike: '🚲', plane: '✈️', truck: '🚚',
  pet: '🐶', dog: '🐶', cat: '🐱', bird: '🐦', fish: '🐠', dinosaur: '🦖', dinosaurs: '🦖',
  rabbit: '🐰', bear: '🧸', elephant: '🐘', lion: '🦁', tiger: '🐯', cow: '🐄',
  park: '🏞️', beach: '🏖️', mountain: '⛰️', forest: '🌲', garden: '🌷', zoo: '🦓',
  weather: '🌤️', sun: '☀️', rain: '🌧️', snow: '❄️', cloud: '☁️', wind: '💨',
  clothes: '👕', shirt: '👕', pants: '👖', shoes: '👟', hat: '🎩', dress: '👗',
  hair: '💇', face: '🙂', tooth: '🦷', teeth: '🦷',
  birthday: '🎂', party: '🎉', holiday: '🎄', christmas: '🎄', halloween: '🎃',
  doctor: '🩺', hospital: '🏥', medicine: '💊',
  shop: '🏬', store: '🏬', mall: '🛍️',
  computer: '💻', phone: '📱', tv: '📺',
  bluey: '🐕', teenieping: '🌸',
  playtime: '🪁', morning: '🌅', evening: '🌆', night: '🌙', tomorrow: '🗓️', today: '📅',
};

const ACTION: Record<string, string> = {
  play: '🪁', plays: '🪁', playing: '🪁', played: '🪁',
  run: '🏃', running: '🏃', ran: '🏃',
  walk: '🚶', walking: '🚶', walked: '🚶',
  jump: '🤸', jumping: '🤸', jumped: '🤸',
  eat: '🍽️', eating: '🍽️', ate: '🍽️',
  drink: '🥤', drinking: '🥤', drank: '🥤',
  sleep: '😴', sleeping: '😴', slept: '😴',
  read: '📖', reading: '📖',
  write: '✍️', writing: '✍️', wrote: '✍️', wrote_: '✍️',
  draw: '✏️', drawing: '✏️', drew: '✏️',
  sing: '🎤', singing: '🎤', sang: '🎤',
  dance: '💃', dancing: '💃', danced: '💃',
  learn: '📚', learning: '📚', learned: '📚', study: '📚', studying: '📚',
  talk: '💬', talking: '💬', talked: '💬', say: '💬', said: '💬', tell: '💬', told: '💬',
  listen: '👂', listening: '👂', listened: '👂', hear: '👂', heard: '👂',
  see: '👀', look: '👀', looking: '👀', looked: '👀', watch: '👀', watching: '👀',
  think: '💭', thinking: '💭', know: '🤔',
  help: '🤝', share: '🤲',
  swim: '🏊', swimming: '🏊', swam: '🏊',
  climb: '🧗',
  ride: '🚴', riding: '🚴',
  build: '🔨', building: '🔨', built: '🔨', make: '🔨', making: '🔨', made: '🔨',
  finish: '✅', finished: '✅', stop: '🛑', go: '➡️',
  cook: '🍳', bake: '🧁',
  brush: '🪥', wash: '🧼', clean: '🧹',
  hug: '🤗', kiss: '😘',
  laugh: '😂', cry: '😭', smile: '😊',
  greet: '👋', wave: '👋', call: '📞',
  drive: '🚗', fly: '✈️',
  paint: '🎨', color: '🎨',
  open: '📂', close: '📁',
  wait: '⏳', start: '🚀',
  practice: '🎯', try: '🎯',
  remember: '🧠', forget: '🌫️', dream: '💭',
  buy: '🛒', sell: '🏷️',
  visit: '🚪',
  show: '📣', present: '🎁',
  give: '🎁', take: '🤲', get: '✋',
  pull: '⬅️', push: '➡️',
  catch: '🥎', throw: '🥏', kick: '🦵',
  fall: '🍂', stand: '🧍', sit: '🪑',
  meet: '🤝', met: '🤝',
};

const EMOTION: Record<string, string> = {
  joyful: '😄', joy: '😄',
  glad: '😊',
  happy: '🥳', happiness: '🥳',
  excited: '🤩', excitement: '🤩',
  sad: '😢', sadness: '😢',
  angry: '😠', anger: '😠', mad: '😡',
  surprised: '😲', surprise: '😲', shocked: '😲',
  bored: '😑', boredom: '😑',
  tired: '😴', sleepy: '😴',
  afraid: '😨', scared: '😨', fear: '😨',
  worried: '😟', anxious: '😟',
  tough: '😣', hard: '😣', difficult: '😣',
  proud: '😎', shy: '🙈',
  confused: '😕', curious: '🤔',
  love: '❤️', loved: '❤️',
  fun: '😄', funny: '🤣',
  calm: '😌', peaceful: '😌',
  embarrassed: '😳', frustrated: '😤',
};

const CORE: Record<string, string> = {
  yes: '✅',
  no: '❌',
  "i don't know": '🤷',
  "how about you?": '🫵',
};

const FALLBACK: Record<CardCategory, string> = {
  topic: '🧩',
  action: '🏃',
  emotion: '🙂',
  core: '✨',
};

function clean(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s']/g, '').trim();
}

function lookupIn(map: Record<string, string>, key: string): string | undefined {
  if (map[key]) return map[key];
  // Try splitting and matching any word
  for (const w of key.split(/\s+/)) {
    if (map[w]) return map[w];
  }
  // Singular/plural fallback
  if (key.endsWith('s') && map[key.slice(0, -1)]) return map[key.slice(0, -1)];
  return undefined;
}

export function emojiForCard(label: string, category: CardCategory): string {
  const k = clean(label);
  switch (category) {
    case 'topic':   return lookupIn(TOPIC, k)   || FALLBACK.topic;
    case 'action':  return lookupIn(ACTION, k)  || FALLBACK.action;
    case 'emotion': return lookupIn(EMOTION, k) || FALLBACK.emotion;
    case 'core':    return CORE[k] || FALLBACK.core;
  }
  return '✨';
}
