// Tiny localStorage wrapper. Everything the app remembers (profile, sessions, card history) lives here;
// there is no server, database or login in this version.
const PREFIX = 'irisspeak_app_';
export const store = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(PREFIX + k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch {} },
};

export interface ChildProfile {
  name: string;
  gender?: 'boy' | 'girl' | null;   // from the shared account; picks the default voice
  setting: string;          // home | school | restaurant | doctor | play | transport | selfcare | unknown
  age?: number | null;
  communication_style?: string | null;
  notes?: string | null;    // free text: interests, friends, routine -> personal cards for the reranker
  /** A/B only: the reranker is off since the distilled model. New key so the old persisted default (true) is not honoured. */
  reranker_ab?: boolean;
}
export const DEFAULT_NOTES = 'likes football, dinosaurs and drawing; friends Sam and Mia; goes to school by bus';
export function getProfile(): ChildProfile {
  return store.get<ChildProfile>('profile', { name: '', setting: 'home', age: null, communication_style: '', notes: DEFAULT_NOTES });
}
export function setProfile(p: ChildProfile) { store.set('profile', p); }

// Card-use history shared across sessions: feeds the reranker's personal bonus and the model prompt.
export interface HistoryTurn { partner: string; answer: string; cards: string[]; t: number; labels?: string[]; setting?: string }   // setting: where the turn happened, for the personal row   // labels: words, for turns made on irisspeak.com whose ids are not ours
export function getHistory(): HistoryTurn[] { return store.get<HistoryTurn[]>('history', []); }
export function pushHistory(t: HistoryTurn) { const h = getHistory(); h.push(t); store.set('history', h.slice(-50)); }
export function clearHistory() { store.set('history', []); }

// Custom words from the shared account (irisspeak.com's dyad_custom_word): searchable cards and reranker favourites.
export interface CustomWordLocal { word: string; category: 'topic' | 'action'; image_url: string | null; emoji: string | null; favourite: boolean }
export function getCustomWords(): CustomWordLocal[] { return store.get<CustomWordLocal[]>('custom_words', []); }
export function setCustomWords(w: CustomWordLocal[]) { store.set('custom_words', w); }
