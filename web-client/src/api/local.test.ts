import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { CardInfo } from './types';

// LocalApi's board logic, driven end to end (startSession → sendParentText → addChildCard → inferSentence →
// confirmCards) against a tiny fake vocabulary. The ONNX card model, the realiser, localStorage and the
// backend are all mocked; what is under test is the pure assembly logic in local.ts: choice-card detection,
// question routing, category mapping, stem de-duplication, the fixed quick row, and the "?" card contract.

// ---- fake engine -------------------------------------------------------------------------------------
const fake = vi.hoisted(() => {
  const rows = [
    { id: 'c_yes', speak: 'yes', category: 'core', core: 1 },
    { id: 'c_no', speak: 'no', category: 'core', core: 1 },
    { id: 'c_please', speak: 'please', category: 'core', core: 1 },
    { id: 'c_me', speak: 'me', category: 'core', core: 1 },
    { id: 'c_i', speak: 'I', category: 'core', core: 1 },
    { id: 'c_want', speak: 'want', category: 'core', core: 1 },
    { id: 'c_juice', speak: 'juice', category: 'drink' },
    { id: 'c_milk', speak: 'milk', category: 'drink' },
    { id: 'c_apple', speak: 'apple', category: 'food' },
    { id: 'c_banana', speak: 'banana', category: 'food' },
    { id: 'c_eat', speak: 'eat', category: 'actions' },
    { id: 'c_drink', speak: 'drink', category: 'actions' },
    { id: 'c_play', speak: 'play', category: 'play' },
    { id: 'c_read', speak: 'read', category: 'activities' },
    { id: 'c_draw', speak: 'draw', category: 'activities' },
    { id: 'c_happy', speak: 'happy', category: 'feelings' },
    { id: 'c_sad', speak: 'sad', category: 'feelings' },
    { id: 'c_tired', speak: 'tired', category: 'feelings' },
    { id: 'c_imtired', speak: "I'm tired", category: 'phrases' },
    { id: 'c_good', speak: 'good', category: 'describing' },
    { id: 'c_sound', speak: 'sound', category: 'things' },
    { id: 'c_soundsgood', speak: 'sounds good', category: 'phrases' },
    { id: 'c_alldone', speak: 'all done', category: 'phrases' },
    { id: 'c_head', speak: 'head', category: 'body' },
    { id: 'c_tummy', speak: 'tummy', category: 'body' },
    { id: 'c_ear', speak: 'ear', category: 'body' },
    { id: 'c_mum', speak: 'mum', category: 'family' },
    { id: 'c_dad', speak: 'dad', category: 'family' },
    { id: 'c_day', speak: 'day', category: 'time' },
    { id: 'c_goodday', speak: 'good day', category: 'phrases' },
    { id: 'c_morning', speak: 'morning', category: 'time' },
    { id: 'c_home', speak: 'home', category: 'places' },
    { id: '<aac_end>', speak: '<aac_end>', category: 'special' },
    { id: '<name>', speak: '<name>', category: 'special' },
  ];
  const cards = rows.map((r, index) => ({ core: 0, safety: 0, composable: 1, multiword: 0, intent: '', ...r, index }));
  const byId: Record<string, (typeof cards)[number]> = {}; const byLabel: Record<string, (typeof cards)[number]> = {};
  for (const c of cards) { byId[c.id] = c; byLabel[c.speak.toLowerCase()] = c; }
  const state = { ranking: [] as string[], personal: [] as string[], history: [] as unknown[], realiser: vi.fn<(labels: string[], q: string, opts?: { avoid?: string[]; sample?: boolean }) => Promise<string | null>>(async () => null) };
  // The model's answer for the next prediction: the listed ids first, then everything else in vocabulary order.
  const predict = vi.fn(async () => {
    const order = [...state.ranking.map(id => byId[id].index), ...cards.map(c => c.index).filter(i => !state.ranking.includes(cards[i].id))];
    const p = new Float32Array(cards.length); order.forEach((j, r) => { p[j] = 1 / (r + 2); });
    return { ranked: order, p, endP: 0 };
  });
  const engine = {
    cards, byId, byLabel, images: {}, folderRows: [] as typeof cards, modelVersion: 'test',
    load: async () => {}, predict,
    personalRow: vi.fn(() => state.personal),
    // Same contract as the real rule: card words in order, capitalised, exactly one trailing full stop.
    realise: (ids: string[]) => { const s = ids.map(id => byId[id]?.speak ?? id).join(' '); return s.charAt(0).toUpperCase() + s.slice(1) + '.'; },
  };
  return { engine, state, byId };
});

vi.mock('../engine/model', () => ({ engine: fake.engine, CORE_LABELS: ['yes', 'no', 'please'], PERSONAL_ROW: 4, QUESTION_CARD_ID: 'core:?' }));
vi.mock('../engine/store', () => {
  const mem = new Map<string, unknown>();
  return {
    store: { get: (k: string, d: unknown) => (mem.has(k) ? mem.get(k) : d), set: (k: string, v: unknown) => { mem.set(k, v); } },
    getProfile: () => ({ name: 'Sammy', setting: 'home', notes: '' }),
    getHistory: () => fake.state.history,
    pushHistory: (t: unknown) => { fake.state.history.push(t); },
  };
});
// The spy snapshots `avoid`: local.ts passes its own candidates array by reference and pushes to it afterwards.
vi.mock('../engine/realiser', () => ({ realiser: { realise: (labels: string[], q: string, opts: { avoid?: string[]; sample?: boolean }) => fake.state.realiser(labels, q, opts?.avoid ? { ...opts, avoid: [...opts.avoid] } : opts) } }));
vi.mock('./remote', () => ({
  remoteNewSession: async () => null, remoteStart: () => {}, remoteParentTurn: vi.fn(), remoteChildTurn: vi.fn(), remoteEnd: () => {},
  remoteRate: () => {}, remoteListSessions: async () => null, remoteDialogue: async () => null, flushFeedback: async () => {},
}));
// local.ts fetches /folders.json at module load; give it one folder so folder cards and routed folder words are exercised.
vi.stubGlobal('fetch', async () => ({ json: async () => ({
  folders: [{ path: 'people', label: 'People', icon: '/people.svg', words: ['mum', 'dad'], triggers: [] }],
  category_to_folder: { family: 'people' },
}) }));

type Api = typeof import('./local').api;
let api: Api;
let remote: typeof import('./remote');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = () => api as any;   // private helpers (choiceCards, sentenceInput, asQuestion) are the real bug surface
const card = (id: string): CardInfo => ({ id, recommendation_id: 'r', label: fake.byId[id]?.speak ?? id, label_localized: fake.byId[id]?.speak ?? id, category: 'topic', corpus_name: fake.byId[id]?.speak ?? id });
const Q: CardInfo = { id: 'core:?', recommendation_id: 'r', label: '?', label_localized: '?', category: 'core', corpus_name: '?' };
const labelsOf = (cards: CardInfo[], cat: string) => cards.filter(c => c.category === cat && !c.is_folder).map(c => c.label);
const last = <T,>(xs: T[], n = 1): T => xs[xs.length - n];   // tsconfig lib is ES2020: no Array.prototype.at

beforeAll(async () => {
  const mod = await import('./local'); api = mod.api; await mod.foldersReady;
  remote = await import('./remote');
});
beforeEach(() => { fake.state.ranking = []; fake.state.personal = []; fake.state.history = []; fake.state.realiser.mockReset().mockResolvedValue(null); api.setPanel({ topic: 15, action: 3, emotion: 3 }); });

async function board(question: string, ranking: string[] = []) {
  fake.state.ranking = ranking;
  const id = await api.newSession({ category: 'plan' }, 'UTC'); await api.startSession(id);
  const r = await api.sendParentText(id, question);
  return { id, cards: r.payload.cards };
}

// ---- choice cards -------------------------------------------------------------------------------------
describe('choiceCards: options named in the question', () => {
  it('finds both sides of "X or Y"', () => {
    expect(priv().choiceCards('Do you want juice or milk?')).toEqual(['c_juice', 'c_milk']);
  });
  it('handles a comma list before "or"', () => {
    expect(priv().choiceCards('Does your head, tummy, or ear hurt?')).toEqual(['c_head', 'c_tummy', 'c_ear']);
  });
  it('matches plurals to the singular card and multi-word options', () => {
    expect(priv().choiceCards('Apples or milk?')).toEqual(['c_apple', 'c_milk']);
    expect(priv().choiceCards('Do you want to play or all done?')).toEqual(['c_play', 'c_alldone']);
  });
  it('ignores questions without "or" and never pins the fixed quick-row words', () => {
    expect(priv().choiceCards('What do you want?')).toEqual([]);
    expect(priv().choiceCards('Yes or no?')).toEqual([]);
    expect(priv().choiceCards('Do you want juice, or not?')).toEqual(['c_juice']);
  });
});

// ---- the "?" card and sentence assembly ---------------------------------------------------------------
describe('sentenceInput / asQuestion: the question-mark card', () => {
  it('strips the "?" card from the words and flags the sentence as a question', () => {
    expect(priv().sentenceInput([card('c_juice'), Q])).toEqual({ labels: ['juice'], question: true });
    expect(priv().sentenceInput([Q, card('c_juice'), card('c_please')])).toEqual({ labels: ['juice', 'please'], question: true });
    expect(priv().sentenceInput([card('c_juice')])).toEqual({ labels: ['juice'], question: false });
  });
  it('replaces the trailing punctuation with "?" rather than appending', () => {
    expect(priv().asQuestion('I want juice.')).toBe('I want juice?');
    expect(priv().asQuestion('Juice!')).toBe('Juice?');
    expect(priv().asQuestion('Juice?')).toBe('Juice?');
    expect(priv().asQuestion('Juice')).toBe('Juice?');
  });
});

describe('inferSentence', () => {
  it('uses the rule when the realiser has nothing, ending in "." without the ? card and "?" with it', async () => {
    const { id } = await board('What do you want?');
    await api.addChildCard(id, card('c_juice')); await api.addChildCard(id, card('c_please'));
    expect((await api.inferSentence(id)).sentence).toBe('Juice please.');
    await api.addChildCard(id, Q);
    expect((await api.inferSentence(id)).sentence).toBe('Juice please?');
  });
  it('never passes "?" to the realiser as a word, and turns its sentence into a question', async () => {
    fake.state.realiser.mockResolvedValue('I want juice please.');
    const { id } = await board('What do you want?');
    await api.addChildCard(id, card('c_juice')); await api.addChildCard(id, Q); await api.addChildCard(id, card('c_please'));
    expect((await api.inferSentence(id)).sentence).toBe('I want juice please?');
    expect(fake.state.realiser).toHaveBeenLastCalledWith(['juice', 'please'], 'What do you want?', {});
  });
  it('"Another" asks the realiser to avoid earlier wordings, then falls back to the rule, then cycles', async () => {
    fake.state.realiser.mockResolvedValueOnce('I would like juice.');
    const { id } = await board('What do you want?');
    await api.addChildCard(id, card('c_juice'));
    expect((await api.inferSentence(id)).sentence).toBe('I would like juice.');
    expect((await api.inferSentence(id, true)).sentence).toBe('Juice.');   // realiser: null → the rule, unseen so far
    expect(fake.state.realiser).toHaveBeenLastCalledWith(['juice'], 'What do you want?', { avoid: ['I would like juice.'], sample: true });
    expect((await api.inferSentence(id, true)).sentence).toBe('I would like juice.');   // nothing new left: cycle back
  });
});

describe('confirmCards', () => {
  it('records the turn without the "?" card and mirrors the sentence to the backend', async () => {
    const { id } = await board('What do you want?');
    await api.addChildCard(id, card('c_juice')); await api.addChildCard(id, Q);
    await api.inferSentence(id);
    await api.confirmCards(id);
    expect(fake.state.history).toHaveLength(1);
    expect(fake.state.history[0]).toMatchObject({ partner: 'What do you want?', answer: 'Juice?', cards: ['c_juice'], setting: 'home' });
    expect(remote.remoteChildTurn).toHaveBeenCalledWith(id, expect.arrayContaining([expect.objectContaining({ id: 'c_juice' }), expect.objectContaining({ id: 'core:?' })]), 'Juice?', expect.any(Array));
    expect(last((await api.getDialogue(id)).dialogue)).toMatchObject({ role: 'child', content_localized: 'Juice?' });
  });
});

// ---- the board ------------------------------------------------------------------------------------------
describe('recommendation: the board', () => {
  it('maps vocabulary categories onto the three panels and keeps the quick row fixed', async () => {
    const { cards } = await board('What do you want?', ['c_happy', 'c_eat', 'c_juice', 'c_sad', 'c_apple', 'c_play', 'c_tired']);
    expect(labelsOf(cards, 'emotion')).toEqual(['happy', 'sad', 'tired']);
    expect(labelsOf(cards, 'action').slice(0, 2)).toEqual(['eat', 'play']);
    expect(labelsOf(cards, 'topic').slice(0, 2)).toEqual(['juice', 'apple']);
    // panels first, then yes / no / please, then the permanent "?" card
    const core = cards.filter(c => c.category === 'core');
    expect(core.map(c => c.label)).toEqual(['yes', 'no', 'please', '?']);
    expect(core[3]).toMatchObject({ id: 'core:?', corpus_name: '?' });
    expect(cards.findIndex(c => c.category === 'core')).toBe(cards.filter(c => c.category !== 'core').length);
  });
  it('appends the personal cards after the "?" card, flagged personal', async () => {
    fake.state.personal = ['c_home', 'c_banana'];
    const { cards } = await board('What do you want?', ['c_juice']);
    expect(cards.slice(-2)).toMatchObject([{ id: 'c_home', category: 'core', personal: true }, { id: 'c_banana', category: 'core', personal: true }]);
    expect(last(cards, 3).id).toBe('core:?');
  });
  it('fills the Feeling panel from the fallback list when the model offers none', async () => {
    const { cards } = await board('What do you want?', ['c_juice', 'c_apple']);
    expect(labelsOf(cards, 'emotion')).toHaveLength(3);
    expect(labelsOf(cards, 'emotion')).toEqual(['happy', 'sad', 'tired']);
  });
  it('pins the options named in the question ahead of the model ranking', async () => {
    const { cards } = await board('Do you want juice or milk?', ['c_apple', 'c_banana', 'c_juice', 'c_milk']);
    expect(labelsOf(cards, 'topic').slice(0, 2)).toEqual(['juice', 'milk']);
  });
  it('skips near-duplicates whose stems are already on the board', async () => {
    const { cards } = await board('What do you want?', ['c_sound', 'c_good', 'c_soundsgood', 'c_tired', 'c_imtired', 'c_apple']);
    const topic = labelsOf(cards, 'topic');
    expect(topic).toContain('sound'); expect(topic).toContain('good');
    expect(topic).not.toContain('sounds good');   // both stems already there
    expect(topic).not.toContain("I'm tired");     // "tired" sits in the Feeling panel
    expect(labelsOf(cards, 'emotion')[0]).toBe('tired');
  });
  it('routes a "who" question: allowed core words and the People folder card last in Topic', async () => {
    const { cards } = await board('Who is coming?', ['c_apple', 'c_mum', 'c_dad']);
    const topic = cards.filter(c => c.category === 'topic');
    expect(topic.slice(0, 3).map(c => c.label)).toEqual(['mum', 'dad', 'me']);   // routed by the question type, best-probability first (apple outranks them but is not a "who" answer)
    expect(last(topic)).toMatchObject({ id: 'folder:people', is_folder: true, folder_path: 'people', label: 'People' });
    expect(topic.filter(c => c.is_folder)).toHaveLength(1);
  });
  it('demotes cards that merely echo an evaluation question, but not greetings', async () => {
    let { cards } = await board('How was your day?', ['c_day', 'c_goodday', 'c_apple']);
    let topic = labelsOf(cards, 'topic');
    // "good" is routed (the "how was" answer words), then the model's picks. Only a card made entirely of the
    // question's words ("day") is an echo and sinks below every other card; "good day" adds a word, so it stays.
    expect(topic.slice(0, 3)).toEqual(['good', 'good day', 'apple']);
    expect(topic).not.toContain('day');
    expect(topic).toContain('home');   // ranked far below "day" by the model, yet on the board instead of it
    ({ cards } = await board('How was your morning?', ['c_morning', 'c_apple']));
    topic = labelsOf(cards, 'topic');
    expect(topic.slice(0, 3)).toEqual(['good', 'morning', 'apple']);
  });
  it('drops a tapped card from the next board and offers the rest as "More ideas"', async () => {
    api.setPanel({ topic: 3, action: 1, emotion: 1 });   // two word cells + the folder cell (People, from the family cards' probability mass)
    const { id } = await board('What do you want?', ['c_juice', 'c_apple', 'c_banana', 'c_milk']);
    const r = await api.addChildCard(id, card('c_juice'));
    expect(labelsOf(r.new_recommendation.cards, 'topic')).toEqual(['apple', 'banana']);
    expect(last(r.new_recommendation.cards.filter(c => c.category === 'topic')).is_folder).toBe(true);
    expect(r.interim_cards.map(c => c.id)).toEqual(['c_juice']);
    const more = api.moreSuggestions(10).map(m => m.word);
    expect(more).toContain('milk'); expect(more).not.toContain('apple'); expect(more).not.toContain('juice');
  });
});
