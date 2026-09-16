// Local replacement for v1's HTTP ApiClient: same method shapes, but every call is answered on the
// device by the IrisSpeak-135M model + reranker, and sessions live in localStorage.
import { engine, CORE_LABELS, PERSONAL_ROW } from '../engine/model';
import { remoteNewSession, remoteStart, remoteParentTurn, remoteChildTurn, remoteEnd, remoteRate, remoteListSessions, remoteDialogue } from './remote';
import { getProfile, getHistory, pushHistory, store } from '../engine/store';
import { realiser } from '../engine/realiser';
import type {
  CardInfo, CardCategory, CardSelectionResult, ChildCardRecommendationResult, DialogueMessage,
  DyadProfile, ExtendedSessionInfo, ParentGuideRecommendationResult, ResponseWithTurnId, SessionStartResult, SessionTopicInfo,
} from './types';

interface SessionRecord extends ExtendedSessionInfo { dialogue: DialogueMessage[] }

// Folder cards (ported from irisspeak.com's data/folder_cards.yml): a curated list of Cboard folders that can
// stand in for a long list of same-kind words ("Numbers" instead of one, two, three...). Loaded from
// public/folders.json. `category_to_folder` maps our vocabulary categories onto them.
interface FolderDef { path: string; label: string; icon: string; words: string[]; triggers: string[] }
interface FolderData { folders: FolderDef[]; category_to_folder: Record<string, string>; card_folder?: Record<string, string> }
let folderData: FolderData = { folders: [], category_to_folder: {} };
/** Browse path of the folder a card lives in: the v2 per-card map first, then the vocabulary category map. */
function folderPathOf(c: { id: string; category: string }): string | undefined { return folderData.card_folder?.[c.id] ?? folderData.category_to_folder[c.category]; }
export const foldersReady = fetch('/folders.json', { cache: 'no-cache' }).then(r => r.json()).then((d: FolderData) => { folderData = d; }).catch(() => {});
const MAX_FOLDER_CARDS = 1;        // one folder card per board, in the last Topic cell (bottom right)
export const PANEL = { topic: 12, action: 3, emotion: 3 };          // Topic 4 x 3, Action 1 x 3, Feeling 1 x 3
export const PANEL_BIG = { topic: 12, action: 3, emotion: 3 };      // same split on iPad landscape and desktops
// Question-type routing: the shape of the partner's question guarantees a folder and a few cards on the
// first board, the way TD Snap's topic pages and Proloquo2Go's fringe folders do by hand. The model still
// fills the rest. `allow` lists words that are normally hidden (core category) but answer this question type.
const ROUTES: { rx: RegExp; folder: string | null; allow: string[]; first?: string[] }[] = [
  { rx: /\b(who|whose|who's|with whom)\b/, folder: 'people', allow: ['me', 'you', 'mine', 'my turn', 'your turn', 'friend', 'mum', 'mom', 'dad', 'teacher', 'nobody'] },
  { rx: /\b(where)\b/, folder: 'places', allow: ['here', 'there', 'home', 'school', 'outside', 'inside'] },
  { rx: /\b(when|what time|how long|how soon)\b/, folder: 'time', allow: ['now', 'later', 'soon', 'today', 'tomorrow', 'not yet'] },
  { rx: /\b(how many|how much|how old|what number|count)\b/, folder: 'numbers', allow: [] },
  { rx: /\b(colou?rs?)\b/, folder: 'describe > colours', allow: [] },
  { rx: /\b(eat|food|breakfast|lunch|dinner|snack|hungry|ate)\b/, folder: 'food', allow: [] },
  { rx: /\b(drink|thirsty)\b/, folder: 'drinks', allow: [] },
  { rx: /\b(play|game|toy|toys)\b/, folder: 'toys', allow: ['ball', 'blocks', 'lego', 'puzzle', 'cars', 'tag', 'outside', 'swing', 'slide'] },
  { rx: /\b(wear|clothes|pyjamas|pajamas|jacket|shoes|dress)\b/, folder: 'clothing', allow: [] },
  { rx: /\b(animal|animals|pet)\b/, folder: 'animals', allow: [] },
  { rx: /\b(hurt|hurts|pain|sore|ache)\b/, folder: 'body', allow: [] },
  { rx: /\b(weather|rain|sunny|snow)\b/, folder: 'weather', allow: [] },
  { rx: /\b(feel|feeling|mood|okay|ok)\b/, folder: null, allow: ['tired', 'sick', 'sad', 'happy', 'scared', 'hurt', 'fine', 'good', 'bad'] },
  { rx: /\b(how was|how is|how's|how did it go|how did .* go|how are you|how're you)\b/, folder: 'Good & nice', allow: ['good', 'bad', 'okay', 'fine', 'great', 'fun', 'boring', 'tired', 'busy', 'long'] },
];
// Where the conversation happens changes what a question means: at the doctor's, "How are you feeling?" is about
// being sick or in pain, not about mood. These answer words go first, in this order (not by model probability),
// and their folder leads.
// No pinned answer words any more. The school-subject and doctor pins existed because the old model could not
// produce those cards; the distilled model can, and with the pins off the audience gates did not move
// (youth 204 -> 204, gen 378 -> 377). Routes still steer the folder and un-hide core words; they no longer answer.
const SETTING_ROUTES: Record<string, { rx: RegExp; folder: string | null; first: string[] }[]> = {
  doctor: [
    { rx: /\b(feel|feeling|mood|okay|ok|how are you|how're you|how's it going|what's wrong|what is wrong|hurt|hurts|pain|sore|sick|better|worse)\b/, folder: 'Health & sick', first: [] },
  ],
};
function routeQuestion(q: string, setting = ''): { folders: string[]; allow: string[]; first: string[] } {
  const s = q.toLowerCase(); const folders: string[] = []; const allow: string[] = []; const first: string[] = [];
  for (const r of SETTING_ROUTES[setting] ?? []) if (r.rx.test(s)) { if (r.folder && !folders.includes(r.folder)) folders.push(r.folder); first.push(...r.first); }
  for (const r of ROUTES) if (r.rx.test(s)) { if (r.folder && !folders.includes(r.folder)) folders.push(r.folder); allow.push(...r.allow); if (r.first) first.push(...r.first); }
  return { folders, allow, first };
}
// For evaluation questions ("How was your day?", "How are you feeling?") a card that repeats a word of the question
// (day, today) is never the answer, yet the sequence model and the question-similarity feature rank it high
// ("good day"). Such cards drop below the model's other picks; greetings echoed back and routed words are exempt.
const EVAL_QUESTION = /\b(how was|how is|how's|how did|how are you|how're you|how's it going|feel|feeling|mood)\b/;
function demoteEchoes(ranked: number[], question: string): number[] {
  if (!EVAL_QUESTION.test(question.toLowerCase())) return ranked;
  const qw = new Set(question.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean));
  const GREETING = new Set(['morning', 'afternoon', 'evening', 'night', 'hello', 'hi', 'hey']);   // "Morning!" back to "Good morning" is a real reply
  const echo = (j: number) => { const c = engine.cards[j]; if (c.is_folder) return false; const ws = c.speak.toLowerCase().split(/\s+/); return ws.every(w => qw.has(w)) && !ws.some(w => GREETING.has(w)); };
  return [...ranked.filter(j => !echo(j)), ...ranked.filter(echo)];
}
const FEELING_FALLBACK = ['happy', 'sad', 'tired', 'excited', 'angry', 'scared', 'bored', 'hungry', 'okay', 'good'];

function loadSessions(): Record<string, SessionRecord> { return store.get<Record<string, SessionRecord>>('sessions', {}); }
function saveSession(s: SessionRecord) { const all = loadSessions(); all[s.id] = s; store.set('sessions', all); }
function categoryOf(vocabCategory: string): CardCategory {
  if (vocabCategory === 'feelings') return 'emotion';
  if (vocabCategory === 'actions' || vocabCategory === 'activities' || vocabCategory === 'play') return 'action';
  return 'topic';
}
let recCounter = 0;
function cardFromVocab(id: string, recId: string, forceCat?: CardCategory): CardInfo {
  const c = engine.byId[id]; const im = engine.images[id] || {};
  return { id, recommendation_id: recId, label: c.speak, label_localized: c.speak, category: forceCat ?? categoryOf(c.category), corpus_name: c.speak, corpus_image_url: im.img ?? null, emoji: im.img ? null : (im.emoji ?? null) };
}

class LocalApi {
  private current: { id: string; question: string; prefix: CardInfo[]; ranked: number[]; endP: number; page: number; role: 'parent' | 'child'; sentence?: string; folders?: FolderDef[]; p?: Float32Array; routed?: string[]; personal?: string[]; lastShown?: CardInfo[]; candidates?: string[] } | null = null;
  private panel = { ...PANEL };
  /** Panel sizes for the current screen (9/6/3 on phones, 12/8/4 on iPad landscape and desktops). */
  setPanel(p: { topic: number; action: number; emotion: number }) { this.panel = { ...p }; }
  async ping() { return true; }

  async newSession(_topic: SessionTopicInfo, tz: string): Promise<string> {
    // signed in: the shared backend issues the id, so the transcript shows up on irisspeak.com and the admin site
    const id = (await remoteNewSession(tz)) ?? 's' + Date.now().toString(36);
    remoteStart(id);
    saveSession({ id, dyad_id: 'local', topic: { category: 'plan' }, status: 'initial', local_timezone: tz, started_timestamp: Date.now(), ended_timestamp: null, num_turns: 0, rating: null, title: null, dialogue: [] });
    return id;
  }
  async startSession(id: string): Promise<SessionStartResult> {
    await engine.load();
    const s = loadSessions()[id]; if (s) { s.status = 'started'; saveSession(s); }
    this.current = { id, question: '', prefix: [], ranked: [], endP: 0, page: 0, role: 'parent' };
    return { turn_id: 't1', parent_guides: { id: 'g', timestamp: Date.now(), turn_id: 't1', guides: [] } };
  }
  async endSession(id: string) { const s = loadSessions()[id]; if (s) { s.status = 'terminated'; s.ended_timestamp = Date.now(); saveSession(s); } if (this.current?.id === id) this.current = null; remoteEnd(id); }
  async abortSession(id: string) { await this.endSession(id); }

  private async recompute(): Promise<ChildCardRecommendationResult> {
    const cur = this.current!;
    const vocabPrefix = cur.prefix.map(c => c.id).filter(id => !!engine.byId[id]);
    const { ranked, endP, p } = await engine.predict(cur.question, vocabPrefix);
    cur.ranked = demoteEchoes(ranked, cur.question); cur.endP = endP; cur.p = p; cur.page = 0;
    return this.recommendation();
  }
  /** Cards named as options in the partner's question ("Read, or draw?", "Head, tummy, or ear?",
   *  "Do you want juice or milk?"). Offering choices only works if the options are on the board, and the
   *  model often misses rare words, so these are pinned to the front of their panels. */
  private choiceCards(question: string): string[] {
    const q = question.toLowerCase().replace(/[^a-z' ,]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/\bor\b/.test(q)) return [];
    const [left, right = ''] = q.split(/\s+or\s+/, 2);
    const lookup = (words: string[]): string | null => {
      for (let n = Math.min(3, words.length); n >= 1; n--) {
        for (const cand of [words.slice(-n).join(' '), words.slice(0, n).join(' ')]) {
          const c = engine.byLabel[cand] ?? engine.byLabel[cand.replace(/s$/, '')];
          if (c && !CORE_LABELS.includes(c.speak.toLowerCase()) && !CORE_LABELS.includes(c.speak)) return c.id;
        }
      }
      return null;
    };
    const found: string[] = [];
    const add = (id: string | null) => { if (id && !found.includes(id)) found.push(id); };
    // left side may be a list: "head, tummy" -> each item; the last item is the option before "or"
    const items = left.split(',').map(x => x.trim()).filter(Boolean);
    const stop = new Set(['do', 'you', 'want', 'to', 'the', 'a', 'an', 'some', 'is', 'it', 'one', 'which', 'what', 'or', 'and', 'with', 'for', 'first', 'should', 'we', 'i', 'your', 'my', 'did', 'too', 'here', 'as', 'last']);
    const optionWords = (phrase: string) => phrase.split(' ').filter(w => w && !stop.has(w));
    for (const it of items) add(lookup(optionWords(it)));
    const rightWords = right.replace(/[,?].*$/, '').split(' ').filter(w => w && !stop.has(w));
    // right side: the option is at the start ("milk", "all done", "take it home")
    for (let n = Math.min(3, rightWords.length); n >= 1; n--) {
      const cand = rightWords.slice(0, n).join(' '); const c = engine.byLabel[cand] ?? engine.byLabel[cand.replace(/s$/, '')];
      if (c && !CORE_LABELS.includes(c.speak.toLowerCase()) && !CORE_LABELS.includes(c.speak)) { add(c.id); break; }
    }
    return found.slice(0, 4);
  }

  /** Decide the folder cards for this turn, once (frozen across taps and refreshes, as in v1):
   *  question routing, then the model's own folder rows (folder rows with at least 8 percent of the probability
   *  mass, best first), then keyword triggers on the partner's message, then the folders whose members carry the
   *  most model probability (3 percent or more). Capped at MAX_FOLDER_CARDS. */
  private decideFolders(): FolderDef[] {
    const cur = this.current!; const chosen: FolderDef[] = []; const q = cur.question.toLowerCase();
    const add = (f?: FolderDef) => { if (f && chosen.length < MAX_FOLDER_CARDS && !chosen.some(x => x.path === f.path)) chosen.push(f); };
    // question-type routing first: a "who" question always gets the People folder, "how many" Numbers, and so on
    for (const path of routeQuestion(cur.question, getProfile().setting).folders) add(folderData.folders.find(f => f.path === path));
    if (engine.folderRows.length && cur.p && cur.prefix.length <= 1) {
      const hits = engine.folderRows.filter(c => cur.p![c.index] >= 0.08).sort((a, b) => cur.p![b.index] - cur.p![a.index]);
      for (const c of hits) add(folderData.folders.find(f => f.path === c.folder));
    }
    for (const f of folderData.folders) if (f.triggers.some(t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(q))) add(f);
    // then the folder whose members sit highest in the reranked order (weight 1 / rank over the top 60, normalised).
    // The reranked order, not the raw model probability: a card the reranker demoted ("Long" for "How was your
    // day?") must not drag its folder onto the board.
    const mass: Record<string, number> = {}; let tot = 0;
    cur.ranked.slice(0, 60).forEach((j, r) => { const path = folderPathOf(engine.cards[j]); if (path) { const w = 1 / (r + 1); mass[path] = (mass[path] || 0) + w; tot += w; } });
    for (const [path, m] of Object.entries(mass).sort((a, b) => b[1] - a[1])) if (m / (tot || 1) >= 0.03) add(folderData.folders.find(f => f.path === path));
    return chosen;
  }
  private folderCard(f: FolderDef, recId: string): CardInfo {
    return { id: 'folder:' + f.path, recommendation_id: recId, label: f.label, label_localized: f.label, category: 'topic', corpus_name: f.label, corpus_image_url: f.icon, emoji: null, is_folder: true, folder_path: f.path };
  }

  private recommendation(): ChildCardRecommendationResult {
    const cur = this.current!; const recId = 'r' + (++recCounter);
    const coreIds = new Set(CORE_LABELS.map(l => engine.byLabel[l]?.id).filter(Boolean));
    const chosen = new Set(cur.prefix.map(c => c.id));
    // v1-style panels: Topic (3 columns), Action (2), Feeling (1), three rows each.
    const lists: Record<'topic' | 'action' | 'emotion', string[]> = { topic: [], action: [], emotion: [] };
    // options offered in the question come first in their panels
    for (const id of this.choiceCards(cur.question)) { if (!chosen.has(id) && !coreIds.has(id)) lists[categoryOf(engine.byId[id].category) as 'topic' | 'action' | 'emotion'].push(id); }
    if (!cur.folders) {
      cur.folders = this.decideFolders();
      // routed cards: the most probable members of the routed folders plus the question type's allowed words
      const { folders: rf, allow, first } = routeQuestion(cur.question, getProfile().setting); const p = cur.p;
      // the setting's answer words come first in their own order (sick / hurt / pain at the doctor's), then the question
      // type's own answer words (me / mine / my turn for "whose"), then the folder's best members
      const firstIds = first.map(w => engine.byLabel[w]?.id).filter((x): x is string => !!x).slice(0, 6);
      const allowIds = [...firstIds, ...allow.map(w => engine.byLabel[w]?.id).filter((x): x is string => !!x && !firstIds.includes(x)).sort((a, b) => (p ? p[engine.byId[b].index] - p[engine.byId[a].index] : 0)).slice(0, 3)];
      const pool = new Map<string, number>();
      for (const f of cur.folders) if (rf.includes(f.path)) for (const w of f.words) { const c = engine.byLabel[w.toLowerCase()]; if (c) pool.set(c.id, p ? p[c.index] : 0); }
      for (const w of allow) { const c = engine.byLabel[w]; if (c) pool.set(c.id, p ? p[c.index] : 0); }
      cur.routed = [...allowIds, ...[...pool.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).filter(id => !allowIds.includes(id))].slice(0, Math.max(4, firstIds.length));
    }
    for (const id of cur.routed ?? []) { if (!chosen.has(id) && !coreIds.has(id)) { const cat = categoryOf(engine.byId[id].category) as 'topic' | 'action' | 'emotion'; if (!lists[cat].includes(id)) lists[cat].push(id); } }
    const keep = new Set((cur.routed ?? []).map(id => engine.byId[id].speak.toLowerCase()));
    const folderWords = new Set(cur.folders.flatMap(f => f.words).filter(w => !keep.has(w.toLowerCase())));
    const folderCats = new Set(cur.folders.map(f => Object.entries(folderData.category_to_folder).find(([, p]) => p === f.path)?.[0]).filter(Boolean));
    const perCat: Record<string, number> = {}; let fillers = 0;
    // Near-duplicates ("Sound", "Good", "Sounds good") would take three slots for one idea: a card whose stems are all
    // already on the board is skipped, unless a route or choice pinned it.
    const GLUE = new Set(['am', 'is', 'are', 'be', 'the', 'a', 'an', 'to', 'of']);   // never makes a card distinct: "I am" = "I"
    const stem = (w: string) => { const x = w.replace(/[^a-z']/g, ''); return x === 'i' ? x : x.replace(/(ies|es|s|ing|ed)$/, ''); };
    // "I'm tired" is the same idea as "Tired": the sentence starter is not what makes a card distinct
    const stemsOf = (speak: string) => speak.toLowerCase().replace(/^(i'm|i am|i feel|i want to|i want|i need to|i need|i like to|i like)\s+/, '').replace(/'m\b/g, ' am').replace(/'s\b/g, '').replace(/n't\b/g, ' not').split(/\s+/).map(stem).filter(x => x.length && !GLUE.has(x));
    const onBoard = new Set<string>(); const pinned = new Set([...(cur.routed ?? []), ...chosen]);
    for (const list of Object.values(lists)) for (const id of list) for (const st of stemsOf(engine.byId[id].speak)) onBoard.add(st);
    for (const j of cur.ranked) {
      const c = engine.cards[j];
      if (c.id === '<aac_end>' || c.id === '<name>' || c.is_folder || coreIds.has(c.id) || chosen.has(c.id)) continue;
      const cat = categoryOf(c.category);
      const sts = stemsOf(c.speak);
      if (!pinned.has(c.id) && sts.length && sts.every(st => onBoard.has(st))) continue;
      // function words (I, to, what, how...) and sentence starters (I am, I feel, I need, I'm) are glue, not answers:
      // at most two of them on the first page
      if ((c.category === 'core' || c.category === 'phrases' || c.speak.toLowerCase() === "i'm") && !lists[cat].includes(c.id) && ++fillers > 2) continue;
      if (cat === 'topic' && cur.folders.length && folderWords.has(c.speak.toLowerCase()) && !lists[cat].includes(c.id)) continue; // the Topic folder covers it
      if (folderCats.has(c.category)) { perCat[c.category] = (perCat[c.category] || 0) + 1; if (perCat[c.category] > 2 && !lists[cat].includes(c.id)) continue; }
      if (!lists[cat].includes(c.id)) { lists[cat].push(c.id); for (const st of sts) onBoard.add(st); }
    }
    for (const l of FEELING_FALLBACK) { const c = engine.byLabel[l]; if (c && !lists.emotion.includes(c.id) && !chosen.has(c.id)) lists.emotion.push(c.id); }
    const cards: CardInfo[] = [];
    for (const [cat, n] of [['topic', this.panel.topic], ['action', this.panel.action], ['emotion', this.panel.emotion]] as const) {
      const list = lists[cat];
      // Refresh pages through the unseen cards; once they run out the page wraps, and a short page is
      // topped up with the category's highest-probability cards so the panel is always full.
      let start = cur.page * n; if (start >= list.length) start = 0;
      const page = list.slice(start, start + n);
      for (const id of list) { if (page.length >= n) break; if (!page.includes(id)) page.push(id); }
      for (const id of page.slice(0, cat === 'topic' ? n - (cur.folders?.length ?? 0) : n)) cards.push(cardFromVocab(id, recId, cat));
      if (cat === 'topic') for (const f of cur.folders ?? []) cards.push(this.folderCard(f, recId));   // last cell of the Topic panel
    }
    for (const l of CORE_LABELS) {
      const c = engine.byLabel[l];
      if (c) cards.push(cardFromVocab(c.id, recId, 'core'));
      else cards.push({ id: 'core:' + l, recommendation_id: recId, label: l, label_localized: l, category: 'core', corpus_name: l, corpus_image_url: null, emoji: null });
    }
    // the five personal cards: chosen once per question so the row holds still while the child taps
    if (!cur.personal && cur.p) cur.personal = engine.personalRow(cur.p, new Set([...cards.map(c => c.id), ...chosen]), getProfile().setting, PERSONAL_ROW);
    for (const id of cur.personal ?? []) if (engine.byId[id]) cards.push({ ...cardFromVocab(id, recId, 'core'), personal: true });
    cur.lastShown = cards;
    return { id: recId, timestamp: Date.now(), cards };
  }
  get endProbability() { return this.current?.endP ?? 0; }
  /** "More ideas": the next N ranked cards that are not on the board, as rows for the folder browser (one tap, no Refresh). */
  moreSuggestions(n = 60): { folder: string; word: string; image_url: string | null; emoji?: string }[] {
    const cur = this.current; if (!cur) return [];
    const on = new Set([...(cur.lastShown ?? []).map(c => c.id), ...cur.prefix.map(c => c.id)]); const out = [];
    for (const j of cur.ranked) {
      const c = engine.cards[j];
      if (c.is_folder || c.id === '<aac_end>' || c.id === '<name>' || on.has(c.id)) continue;
      const im = engine.images[c.id] || {};
      out.push({ folder: 'More ideas', word: c.speak, image_url: im.img ?? null, emoji: im.img ? undefined : (im.emoji ?? '💬') });
      if (out.length >= n) break;
    }
    return out;
  }

  async sendParentText(id: string, message: string): Promise<ResponseWithTurnId<ChildCardRecommendationResult>> {
    const cur = this.current!; cur.question = message; cur.prefix = []; cur.role = 'child'; cur.folders = undefined; cur.routed = undefined; cur.personal = undefined;
    remoteParentTurn(id, message);
    const s = loadSessions()[id]; if (s) { s.dialogue.push({ role: 'parent', content: message }); s.status = 'conversation'; s.num_turns += 1; if (!s.title) s.title = message.slice(0, 60); saveSession(s); }
    return { payload: await this.recompute(), next_turn_id: 't' + Date.now() };
  }
  async addChildCard(_id: string, card: CardInfo): Promise<CardSelectionResult> {
    const cur = this.current!; cur.prefix = [...cur.prefix, card];
    return { interim_cards: cur.prefix, new_recommendation: await this.recompute() };
  }
  async addFreeCard(_id: string, label: string, category: string, image_url: string | null): Promise<CardSelectionResult> {
    const cur = this.current!; const vocab = engine.byLabel[label.toLowerCase()];
    const card: CardInfo = vocab ? cardFromVocab(vocab.id, 'free') : { id: `free-${Date.now()}`, recommendation_id: 'free', label, label_localized: label, category: category as CardCategory, corpus_name: label, corpus_image_url: image_url };
    cur.prefix = [...cur.prefix, card];
    return { interim_cards: cur.prefix, new_recommendation: await this.recompute() };
  }
  /** Clear the whole selection and re-predict from the question alone. */
  async clearCards(_id: string): Promise<CardSelectionResult> {
    const cur = this.current!; cur.prefix = []; cur.page = 0;
    return { interim_cards: cur.prefix, new_recommendation: await this.recompute() };
  }
  async removeCard(_id: string, index: number): Promise<CardSelectionResult> {
    const cur = this.current!; cur.prefix = cur.prefix.filter((_, i) => i !== index);
    return { interim_cards: cur.prefix, new_recommendation: await this.recompute() };
  }
  /** Re-run the model for the current question + selection (used when the setting changes). */
  async repredict(): Promise<ChildCardRecommendationResult | null> { return this.current && this.current.role === 'child' ? this.recompute() : null; }
  async refreshCards(_id: string): Promise<ChildCardRecommendationResult> { const cur = this.current!; cur.page += 1; return this.recommendation(); }
  /** Sentence from the tapped cards, on the device: the realiser model (cards + the partner's question, constrained
   *  to the card words plus function words), or the rule (cards in order) until it has loaded. No cloud call. */
  async inferSentence(_id: string, again = false): Promise<{ sentence: string; source: 'cloud' | 'device' }> {
    const cur = this.current!; const labels = cur.prefix.map(c => c.corpus_name || c.label);
    const rule = engine.realise(labels);
    if (!again || !cur.candidates) cur.candidates = [];
    let sentence: string | null = null;
    try { sentence = await realiser.realise(labels, cur.question, again ? { avoid: cur.candidates, sample: true } : {}); } catch (e) { console.info('realiser failed, using the rule', e); }
    // "Another": a fresh wording; when the model has none left, the plain card order, then cycle through earlier ones.
    if (!sentence) {
      if (again && !cur.candidates.includes(rule)) sentence = rule;
      else if (again && cur.candidates.length) sentence = cur.candidates[(cur.candidates.indexOf(cur.sentence || '') + 1) % cur.candidates.length];
      else sentence = rule;
    }
    if (!cur.candidates.includes(sentence)) cur.candidates.push(sentence);
    cur.sentence = sentence;
    return { sentence, source: 'device' };
  }
  async confirmCards(id: string): Promise<ResponseWithTurnId<ChildCardRecommendationResult>> {
    const cur = this.current!; const sentence = cur.sentence || engine.realise(cur.prefix.map(c => c.corpus_name || c.label)); cur.sentence = undefined;
    const s = loadSessions()[id]; if (s) { s.dialogue.push({ role: 'child', content: cur.prefix, content_localized: sentence }); saveSession(s); }
    pushHistory({ partner: cur.question, answer: sentence, cards: cur.prefix.map(c => c.id).filter(x => !!engine.byId[x]), t: Date.now(), setting: getProfile().setting });
    remoteChildTurn(id, cur.prefix, sentence, cur.lastShown ?? []);
    cur.prefix = []; cur.folders = undefined; cur.routed = undefined; cur.personal = undefined;
    return { payload: await this.recompute(), next_turn_id: 't' + Date.now() };
  }
  async finishChildTurn(id: string): Promise<ResponseWithTurnId<ParentGuideRecommendationResult>> {
    const cur = this.current!; cur.role = 'parent'; cur.prefix = [];
    const s = loadSessions()[id]; if (s) { s.num_turns += 1; saveSession(s); }
    return { payload: { id: 'g', timestamp: Date.now(), turn_id: 't', guides: [] }, next_turn_id: 't' + Date.now() };
  }
  /** Transcript: the shared account's copy (it has every device's turns), else this device's. */
  async getDialogue(id: string) {
    const remote = await remoteDialogue(id);
    if (remote && remote.dialogue.length) return { dyad_id: 'account', dialogue: remote.dialogue as DialogueMessage[] };
    return { dyad_id: 'local', dialogue: loadSessions()[id]?.dialogue ?? [] };
  }
  /** Previous conversations: the shared account's list (irisspeak.com, other devices) merged with this device's. */
  async listSessions() {
    const local = Object.values(loadSessions()).map(({ dialogue: _d, ...s }) => s);
    const remote = await remoteListSessions();
    if (!remote) return { dyad_id: 'local', sessions: local };
    const byId = new Map<string, ExtendedSessionInfo>();
    for (const s of remote.sessions as ExtendedSessionInfo[]) byId.set(s.id, s);
    for (const s of local) if (!byId.has(s.id)) byId.set(s.id, s);   // made offline, never reached the server
    return { dyad_id: 'account', sessions: [...byId.values()] };
  }
  async getSessionInfo(id: string) { const { dialogue: _d, ...s } = loadSessions()[id]; return s; }
  async rateSession(id: string, rating: number) { const s = loadSessions()[id]; if (s) { s.rating = rating; saveSession(s); } remoteRate(id, rating); }
  async getProfile(): Promise<DyadProfile> { const p = getProfile(); return { age: p.age ?? null, notes: p.notes ?? null, communication_style: p.communication_style ?? null }; }
  historyCount() { return getHistory().length; }
}
export const api = new LocalApi();
