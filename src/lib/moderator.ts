/**
 * Turn-loop orchestration. Mirrors libs/py_core/py_core/system/moderator.py.
 *
 * Public surface:
 *   submitParentMessage(session, dyad, text) → ChildCardRecommendationResult
 *   addChildCard(session, dyad, card) → CardSelectionResult
 *   refreshChildCards(session, dyad) → ChildCardRecommendationResult
 *   popLastChildCard(session, dyad) → CardSelectionResult
 *   confirmChildCardSelection(session, dyad) → ChildCardRecommendationResult (banks the sentence, stays child's turn)
 *   finishChildTurn(session, dyad) → ParentGuideRecommendationResult (hands the turn to the parent)
 *   startSession(session, dyad) → ParentGuideRecommendationResult
 *
 * Persistence: Postgres (Neon) — see db.ts for schema.
 */
import { nanoid } from 'nanoid';
import YAML from 'yaml';
import { sql, ensureSchema } from './db';
import { getCorpusRetriever, mergeDyadWords, lookupDyadWord } from './corpus';
import type { DyadCustomWord } from './corpus';
import { chat, extractYamlList, stripFence } from './gemini';
import {
  buildChildCardPrompt, buildParentGuidePrompt, buildSentenceInferencePrompt, buildSessionTitlePrompt,
  dialogueToXml,
} from './prompts';
import { buildInitialGuides, loadCoreCards, loadFolderCards } from './staticData';
import type { FolderCardOption } from './staticData';
import type {
  CardInfo, CardSelectionResult, ChildCardRecommendationResult, DialogueMessage, Dyad,
  ParentGuideElement, ParentGuideRecommendationResult, SessionTopicInfo, TopicCategory,
} from './types';

// Every message gets at most this many folder cards — keeps folder suggestions rare and the
// topic column mostly real words, per product intent (folders are for the clear-cut cases only).
const MAX_FOLDER_CARDS = 2;

// Deterministic backstop for the LLM's folder-card judgment call: even with a strongly-worded
// prompt, Gemini doesn't reliably suggest a folder for the most obvious cases (empirically,
// misses "How old are you?" a meaningful fraction of the time — see CONTEXT.md's Folder Card
// entry). Trigger phrases live in each folder's `triggers` field in data/folder_cards.yml (not
// here) so adding folder coverage is a pure data edit — this just builds a word-boundary regex
// per phrase and checks it, generically, over whichever folders are currently allow-listed.
function triggerRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

export function detectFoldersByKeyword(text: string, folderOptions: FolderCardOption[]): FolderCardOption[] {
  const matches: FolderCardOption[] = [];
  for (const entry of folderOptions) {
    if (entry.triggers?.some((phrase) => triggerRegex(phrase).test(text))) {
      matches.push(entry);
    }
  }
  return matches;
}

// Fixed feeling set — shown every turn, not LLM-generated, matched to real Cboard images.
const FIXED_FEELINGS: { word: string; phrase: string }[] = [
  { word: 'angry', phrase: "I'm angry" },
  { word: 'happy', phrase: "I'm happy" },
  { word: 'confused', phrase: "I'm confused" },
  { word: 'sad', phrase: "I'm sad" },
];

// ---------- helpers ----------
function now(): number { return Date.now(); }

// See CONTEXT.md's Profile Fact entry — shared between card generation and sentence inference
// so a child's age/communication style/notes/known favorites inform BOTH what words they're
// offered and how the LLM turns their taps into a sentence, not just the former. Always
// included in full, never gated behind keyword matching (same rationale as Profile Fact).
function buildProfileFacts(dyad: Dyad, preferencePointers: string[] = []): string | undefined {
  const factParts: string[] = [];
  if (dyad.age != null) factParts.push(`age ${dyad.age}`);
  if (dyad.communication_style) factParts.push(`communicates via ${dyad.communication_style}`);
  if (preferencePointers.length) factParts.push(`known favorites: ${preferencePointers.join(', ')}`);
  if (dyad.notes) factParts.push(dyad.notes);
  return factParts.length ? factParts.join('; ') : undefined;
}

/** Every session route must act only on the caller's own sessions. */
async function assertOwner(sessionId: string, dyad: Dyad): Promise<void> {
  const rows = (await sql`SELECT dyad_id FROM session WHERE id = ${sessionId} LIMIT 1`) as any[];
  if (!rows[0]) throw new Error('not found');
  if (rows[0].dyad_id !== dyad.id) throw new Error('forbidden');
}

async function getCurrentTurn(sessionId: string): Promise<{ id: string; role: 'parent' | 'child'; ended_timestamp: number | null } | null> {
  const r = (await sql`
    SELECT id, role, ended_timestamp
    FROM dialogue_turn
    WHERE session_id = ${sessionId}
    ORDER BY started_timestamp DESC
    LIMIT 1
  `) as any[];
  return r[0] || null;
}

// The Neon HTTP driver pays a full network round trip per query (measured ~75-100ms warm,
// 200ms+ cold) with no pipelining, so every independent pair of queries collapsed into a
// Promise.all below is a real, measured latency cut — not a stylistic change. newTurn's two
// writes touch different rows (dialogue_turn insert, session update) so they're safe to fire
// concurrently; same for switchTurn/continueTurnAsChild's "close old turn" + "open new turn".
async function newTurn(sessionId: string, role: 'parent' | 'child'): Promise<{ id: string; role: 'parent' | 'child'; ended_timestamp: null }> {
  const id = nanoid();
  const ts = now();
  await Promise.all([
    sql`
      INSERT INTO dialogue_turn (id, session_id, role, started_timestamp)
      VALUES (${id}, ${sessionId}, ${role}, ${ts})
    `,
    sql`UPDATE session SET num_turns = num_turns + 1 WHERE id = ${sessionId}`,
  ]);
  return { id, role, ended_timestamp: null };
}

// `knownCur` lets callers that already fetched the current turn a moment ago (nothing that
// would change it happened in between) skip re-querying it here.
async function switchTurn(
  sessionId: string,
  knownCur?: { id: string; role: 'parent' | 'child'; ended_timestamp: number | null } | null,
): Promise<{ id: string; role: 'parent' | 'child'; ended_timestamp: null }> {
  const cur = knownCur !== undefined ? knownCur : await getCurrentTurn(sessionId);
  const nextRole = !cur || cur.role === 'child' ? 'parent' : 'child';
  const [nextTurn] = await Promise.all([
    newTurn(sessionId, nextRole),
    cur && cur.ended_timestamp == null
      ? sql`UPDATE dialogue_turn SET ended_timestamp = ${now()} WHERE id = ${cur.id}`
      : Promise.resolve(),
  ]);
  return nextTurn;
}

// Ends the current turn and starts a fresh one for the SAME role, instead of
// flipping like switchTurn does — used when the child banks a sentence but
// isn't done yet, so they can build another one without handing off to the parent.
async function continueTurnAsChild(
  sessionId: string,
  knownCur?: { id: string; role: 'parent' | 'child'; ended_timestamp: number | null } | null,
): Promise<{ id: string; role: 'child'; ended_timestamp: null }> {
  const cur = knownCur !== undefined ? knownCur : await getCurrentTurn(sessionId);
  const [nextTurn] = await Promise.all([
    newTurn(sessionId, 'child'),
    cur && cur.ended_timestamp == null
      ? sql`UPDATE dialogue_turn SET ended_timestamp = ${now()} WHERE id = ${cur.id}`
      : Promise.resolve(),
  ]);
  return nextTurn as { id: string; role: 'child'; ended_timestamp: null };
}

async function getDialogue(sessionId: string): Promise<DialogueMessage[]> {
  const rows = (await sql`
    SELECT role, content, content_type, timestamp, turn_id
    FROM dialogue_message
    WHERE session_id = ${sessionId}
    ORDER BY timestamp ASC
  `) as any[];
  return rows.map((r) => ({
    role: r.role,
    content: r.content_type === 'text' ? String(r.content) : r.content,
    turn_id: r.turn_id,
    timestamp: Number(r.timestamp),
  }));
}

async function persistMessage(sessionId: string, turnId: string, role: 'parent' | 'child', content: string | CardInfo[], contentType: 'text' | 'cards'): Promise<void> {
  await sql`
    INSERT INTO dialogue_message (id, session_id, turn_id, role, content_type, content, timestamp)
    VALUES (${nanoid()}, ${sessionId}, ${turnId}, ${role}, ${contentType}, ${JSON.stringify(content)}, ${now()})
  `;
}

// ---------- start session (initial parent guides) ----------
export async function startSession(sessionId: string, dyad: Dyad): Promise<{ turn_id: string; recommendation: ParentGuideRecommendationResult }> {
  await ensureSchema();
  const session = (await sql`SELECT * FROM session WHERE id = ${sessionId} LIMIT 1`) as any[];
  if (!session[0]) throw new Error('session not found');
  const sess = session[0];
  if (sess.dyad_id !== dyad.id) throw new Error('forbidden');

  // Already started — return current state instead of erroring out (same forgiving behavior the web client wants)
  if (sess.status !== 'initial') {
    const cur = await getCurrentTurn(sessionId);
    const lastGuide = (await sql`
      SELECT * FROM parent_guide_recommendation
      WHERE session_id = ${sessionId}
      ORDER BY timestamp DESC LIMIT 1
    `) as any[];
    if (lastGuide[0]) {
      return {
        turn_id: cur?.id || lastGuide[0].turn_id,
        recommendation: {
          id: lastGuide[0].id,
          timestamp: Number(lastGuide[0].timestamp),
          turn_id: lastGuide[0].turn_id,
          guides: lastGuide[0].guides as ParentGuideElement[],
        },
      };
    }
  }

  // Mark started + create the first parent turn
  await sql`UPDATE session SET status = 'started', started_timestamp = ${now()} WHERE id = ${sessionId}`;
  const turn = await newTurn(sessionId, 'parent');

  // Static initial guides (no LLM)
  const guides = buildInitialGuides(sess.topic_category as TopicCategory, dyad.child_name);

  const recId = nanoid();
  const ts = now();
  await sql`
    INSERT INTO parent_guide_recommendation (id, session_id, turn_id, guides, timestamp)
    VALUES (${recId}, ${sessionId}, ${turn.id}, ${JSON.stringify(guides)}, ${ts})
  `;
  await sql`UPDATE session SET status = 'conversation' WHERE id = ${sessionId}`;

  return {
    turn_id: turn.id,
    recommendation: { id: recId, timestamp: ts, turn_id: turn.id, guides },
  };
}

// The reusable-across-refreshes ranked candidate list for one turn. `folderPaths` is `null`
// until the folder decision has been made once (even a "no folder" decision is `[]`, not
// `null`) — see the pool top-up block in generateChildCards for why this must only happen once.
interface CardPool {
  topics: string[];
  actions: string[];
  folderPaths: string[] | null;
  // Whether this turn shows a direct "I'm 7 years old" answer card — decided once (frozen)
  // alongside folderPaths, for the same reason: without freezing, this could flicker in/out
  // across refreshes of the same turn just like the folder decision used to.
  showAgeCard: boolean | null;
  // Small-talk answer card — 'none' once decided-and-negative (never re-rolled, same freezing
  // rationale as folderPaths/showAgeCard); null only before the first decision.
  smallTalk: 'hi' | 'bye' | 'thanks' | 'wellbeing' | 'none' | null;
}
const EMPTY_POOL: CardPool = {
  topics: [], actions: [], folderPaths: null, showAgeCard: null, smallTalk: null,
};

// Deliberately separate from the 45-folder data-driven trigger system in folder_cards.yml —
// these are fixed, singular features (surfacing a known profile fact, or answering small talk),
// not a scaling problem across many categories, so a small hardcoded list here is simpler than a
// generic mechanism built for one or two cases.
//
// "How old are you"/"your age" already opens the Numbers folder (data/folder_cards.yml) for
// browsing any number; INTRO_TRIGGERS additionally covers the broader "introduce yourself"
// framing, where the point isn't browsing — the exact age is already known, so making the child
// hunt for it in a folder would defeat the purpose.
const INTRO_TRIGGERS = ['introduce yourself', 'tell me about yourself', 'who are you'];

// "hello"/"goodbye" (plus "good", "bad", "thank you", "please") already exist in
// data/corpus_vocabulary.csv tagged `core` — but generateChildCards only ever pulls the `topic`/
// `action` categories into the LLM prompt, so these have sat unused. Rather than folding them
// into that pipeline (which would mean asking the LLM to judge small talk on top of everything
// else it already judges), this reuses the same direct-answer-card pattern as showAgeCard:
// deterministic trigger, frozen once per turn, corpus_name still points at the real corpus entry
// (so it gets its actual image and isn't treated as invented). Anchored at the START of the
// message — greetings are almost always message-initial ("Hi Sammy!"), and anchoring avoids
// false-firing on a message that merely mentions "hi" mid-sentence.
const GREETING_TRIGGER = /^\s*(hi|hello|hey)\b/i;
// Not anchored, unlike GREETING_TRIGGER — farewells are commonly NOT message-initial
// ("Okay, goodbye!", "See you later, bye!"), so anchoring here would miss the common case.
const FAREWELL_TRIGGER = /\b(bye|goodbye)\b|\bsee you\b|\bgood night\b/i;
// A parent complimenting the child — not just effort-praise ("Good job!", "I'm so proud of
// you") but everyday compliments about appearance/belongings ("Nice shoes!", "I like your
// shirt", "You look great"), which are at least as common in practice. "Thank you" is the
// natural response to all of these, and (like hello/goodbye) already exists in the corpus with
// a real image. `(?:nice|cool|pretty|beautiful|lovely|awesome|amazing)\s+\w+` deliberately
// requires a following word (so bare "nice" doesn't false-fire on e.g. "that's nice, okay") —
// this also reuses "nice work"/"nice job" for free instead of needing its own literal entries.
const COMPLIMENT_TRIGGER = /\bgood job\b|\bgreat job\b|\bwell done\b|\bproud of you\b|\byou did it\b|\b(?:nice|cool|pretty|beautiful|lovely|awesome|amazing)\s+\w+\b|\bi like your\b|\blove your\b|\byou look (?:nice|great|good|beautiful|handsome|cool|pretty|amazing)\b|\bthat looks (?:nice|great|good|beautiful|cool|amazing)\b/i;
// A parent asking the child to rate/recap how something went — "How was your day?", but just as
// often "How was your trip/the party/school today?", or a direct yes/no-shaped check like "Was
// this good?"/"Was that fun?". Deliberately NOT anchored to "day" specifically — in real use the
// parent asks about whatever just happened, so this matches the general "how was your ___"/
// "how's your ___" shape rather than one literal sentence. "good"/"bad" are the natural direct
// answers, and (like hello/goodbye/thank you) already exist in the corpus tagged `core` with
// real images, just never surfaced. Unlike the other small-talk cases this answers with a PAIR
// of cards (good AND bad), since — unlike a greeting or a compliment — there isn't one
// obviously-correct response.
const WELLBEING_TRIGGER = /\bhow('?s| was| is) your\b|\bhow are you\b|\bhow'?s it going\b|\bhow (do|are) you feel(ing)?\b|\bwas (this|that|it) (good|fun|okay|ok)\b/i;

// Below this many unseen ranked candidates left in the pool, a refresh needs to top up via a
// fresh LLM call rather than just paging through what's already ranked.
const MIN_POOL_DEPTH = 4;

// ---------- core: generate child cards from a parent message context ----------
async function generateChildCards(args: {
  sessionId: string;
  turnId: string;
  dyad: Dyad;
  topic: SessionTopicInfo;
  interimCards?: CardInfo[];
}): Promise<ChildCardRecommendationResult> {
  const { dyad } = args;

  // These reads don't depend on each other, so fetch them concurrently instead of paying
  // sequential network round trips (getCorpusRetriever is in-memory-cached after the very
  // first call anyway, but including it here costs nothing and keeps the shape uniform).
  const [dialogue, prevRecsRows, corpus, customWordRows] = await Promise.all([
    getDialogue(args.sessionId),
    sql`
      SELECT cards, pool FROM child_card_recommendation
      WHERE session_id = ${args.sessionId} AND turn_id = ${args.turnId}
      ORDER BY timestamp ASC
    ` as Promise<any[]>,
    getCorpusRetriever(),
    sql`
      SELECT word, category, is_preference_pointer, image_data, emoji
      FROM dyad_custom_word WHERE dyad_id = ${dyad.id}
    ` as unknown as Promise<DyadCustomWord[]>,
  ]);

  // Collect ALL topic/action labels shown in any previous recommendation this turn → avoid repeating
  const seenLabels = new Set<string>();
  for (const row of prevRecsRows) {
    const prevCards: CardInfo[] = row.cards || [];
    prevCards
      .filter((c) => c.category === 'topic' || c.category === 'action')
      .forEach((c) => seenLabels.add((c.corpus_name || c.label).toLowerCase()));
  }

  const topicVocab = mergeDyadWords(corpus.wordsByCategory('topic'), customWordRows, 'topic');
  const actionVocab = mergeDyadWords(corpus.wordsByCategory('action'), customWordRows, 'action');
  const folderOptions = loadFolderCards();

  // Ranked candidate pool, carried forward (and topped up as needed) across every call in this
  // turn — this is what turns "refresh" into deterministic pagination through pre-ranked
  // candidates instead of a fresh, differently-themed LLM regeneration each time. Seeded from
  // the turn's most recent recommendation row; empty/undecided on the turn's first call, or for
  // a legacy row from before the `pool` column existed (which just behaves like a first call).
  const lastPool: CardPool = (prevRecsRows.length && prevRecsRows[prevRecsRows.length - 1].pool) || EMPTY_POOL;
  const pool: CardPool = {
    topics: [...lastPool.topics], actions: [...lastPool.actions],
    folderPaths: lastPool.folderPaths, showAgeCard: lastPool.showAgeCard ?? null,
    smallTalk: lastPool.smallTalk ?? null,
  };

  const unseen = (words: string[]) => words.filter((w) => !seenLabels.has(w.toLowerCase()));

  // Folder/age/small-talk decisions must each happen exactly once per turn (see CardPool doc
  // comment), so top up whenever any hasn't run yet, even if the pool otherwise has plenty of depth.
  const needsTopUp = unseen(pool.topics).length < MIN_POOL_DEPTH
    || unseen(pool.actions).length < MIN_POOL_DEPTH
    || pool.folderPaths === null
    || pool.showAgeCard === null
    || pool.smallTalk === null;

  if (needsTopUp) {
    // Preference-pointer custom words (e.g. "favorite color: red") are folded in here rather
    // than the vocab list, since the word itself already exists there.
    const preferencePointers = customWordRows.filter((w) => w.is_preference_pointer).map((w) => w.word);
    const profileFacts = buildProfileFacts(dyad, preferencePointers);

    const sysPrompt = buildChildCardPrompt({
      topic: args.topic.category,
      topicVocab,
      actionVocab,
      seenLabels: [...seenLabels, ...pool.topics, ...pool.actions],
      interimCards: args.interimCards,
      folderOptions,
      profileFacts,
    });

    const raw = await chat([
      { role: 'system', content: sysPrompt },
      { role: 'user',   content: dialogueToXml(dialogue) },
    ]);

    // Extract the topics/actions/folder lines directly rather than requiring the whole response
    // to be valid YAML — Gemini sometimes writes its reasoning out as prose before the
    // structured output despite being told not to, which would break a strict whole-document
    // parse even though the YAML we actually want is sitting right there intact.
    //
    // Requested 12 ranked candidates per topic/action category (see buildChildCardPrompt) — a
    // deep enough reservoir to cover the initial batch plus a couple of refreshes purely by
    // paging through this one response, without calling the LLM again.
    const newTopics = extractYamlList(raw, 'topics').slice(0, 12);
    const newActions = extractYamlList(raw, 'actions').slice(0, 12);
    const folderPicks = extractYamlList(raw, 'folder').slice(0, MAX_FOLDER_CARDS);

    // Resolve each candidate against the corpus (dropping anything hallucinated outside the
    // fixed vocab — falling through to this dyad's Custom Vocabulary Words first, per
    // CONTEXT.md's Custom Vocabulary Word entry) and append the valid, not-yet-pooled ones.
    // Backfills straight from the vocab list if the LLM response resolved too few to guarantee a
    // full display batch, same guarantee the old single-shot resolveCategory used to provide.
    function topUpCategory(words: string[], vocab: string[], into: string[]) {
      const already = new Set(into.map((w) => w.toLowerCase()));
      for (const w of words) {
        const entry = lookupDyadWord(corpus, w, customWordRows);
        if (!entry) {
          console.warn(`[child-cards] "${w}" not in corpus vocab — dropping`);
          continue;
        }
        const key = entry.name.toLowerCase();
        if (already.has(key) || seenLabels.has(key)) continue;
        already.add(key);
        into.push(entry.name);
      }
      if (unseen(into).length < MIN_POOL_DEPTH) {
        for (const w of vocab) {
          if (unseen(into).length >= MIN_POOL_DEPTH) break;
          const key = w.toLowerCase();
          if (already.has(key) || seenLabels.has(key)) continue;
          already.add(key);
          into.push(w);
        }
      }
    }
    topUpCategory(newTopics.map(String), topicVocab, pool.topics);
    topUpCategory(newActions.map(String), actionVocab, pool.actions);

    // Folder card(s) (e.g. "Numbers") — decided exactly once per turn (frozen into the pool from
    // here on) so a folder card can't flicker in or out across refreshes within the same turn.
    // Sourced from whichever of the LLM's picks are actually in the curated allow-list (anything
    // else, e.g. a hallucinated name, is dropped) PLUS a deterministic keyword match against the
    // parent's last message (see detectFoldersByKeyword) so obvious cases don't depend purely on
    // the LLM remembering to suggest one. Deduped by path, capped at MAX_FOLDER_CARDS.
    const lastParentMsg = [...dialogue].reverse().find((m) => m.role === 'parent' && typeof m.content === 'string');

    if (pool.folderPaths === null) {
      const decided: FolderCardOption[] = [];
      const usedFolderPaths = new Set<string>();
      for (const pick of folderPicks) {
        const entry = folderOptions.find((f) => f.path.toLowerCase() === pick.toLowerCase());
        if (!entry) {
          console.warn(`[child-cards] folder "${pick}" not in allow-list — dropping`);
          continue;
        }
        if (usedFolderPaths.has(entry.path)) continue;
        usedFolderPaths.add(entry.path);
        decided.push(entry);
      }
      if (decided.length < MAX_FOLDER_CARDS && lastParentMsg) {
        for (const entry of detectFoldersByKeyword(lastParentMsg.content as string, folderOptions)) {
          if (decided.length >= MAX_FOLDER_CARDS) break;
          if (usedFolderPaths.has(entry.path)) continue;
          usedFolderPaths.add(entry.path);
          decided.push(entry);
        }
      }
      pool.folderPaths = decided.map((f) => f.path);
    }

    // Direct "I'm 7 years old" answer card — only when the age is actually known (a dyad without
    // an age on file gets nothing here, not a placeholder) and either an explicit intro question
    // or the same age-phrasing that already opens the Numbers folder (see INTRO_TRIGGERS doc
    // comment above for why this exists alongside, not instead of, that folder).
    if (pool.showAgeCard === null) {
      const numbersFolder = folderOptions.find((f) => f.path === 'numbers');
      const ageTriggers = [...INTRO_TRIGGERS, ...(numbersFolder?.triggers || [])];
      pool.showAgeCard = dyad.age != null && !!lastParentMsg
        && ageTriggers.some((phrase) => triggerRegex(phrase).test(lastParentMsg.content as string));
    }

    // Small-talk answer card — "Hi!" for a greeting, "Bye!" for a farewell, "Thank you!" for a
    // compliment, or a "Good!"/"Bad!" pair for a wellbeing question; never more than one
    // category at a time.
    if (pool.smallTalk === null) {
      const msg = lastParentMsg && typeof lastParentMsg.content === 'string' ? lastParentMsg.content : '';
      if (GREETING_TRIGGER.test(msg)) pool.smallTalk = 'hi';
      else if (FAREWELL_TRIGGER.test(msg)) pool.smallTalk = 'bye';
      else if (COMPLIMENT_TRIGGER.test(msg)) pool.smallTalk = 'thanks';
      else if (WELLBEING_TRIGGER.test(msg)) pool.smallTalk = 'wellbeing';
      else pool.smallTalk = 'none';
    }
  }

  const folderEntries = (pool.folderPaths || [])
    .map((path) => folderOptions.find((f) => f.path === path))
    .filter((f): f is FolderCardOption => !!f);
  // A folder card already covers its own contents (e.g. "Numbers" covers "five", "six", ...) —
  // don't also offer those same words loose in the topic column, or the child sees the same
  // answer twice.
  const folderExcludedWords = new Set(folderEntries.flatMap((f) => f.words.map((w) => w.toLowerCase())));
  // The age card takes a topic slot the same way a folder card does (see CardPool.showAgeCard).
  // Wellbeing takes two slots (a Good/Bad pair); the other small-talk kinds take one.
  const smallTalkSlots = pool.smallTalk === 'wellbeing' ? 2
    : (pool.smallTalk === 'hi' || pool.smallTalk === 'bye' || pool.smallTalk === 'thanks') ? 1 : 0;
  const topicSlotCount = Math.max(0, 4 - folderEntries.length
    - (pool.showAgeCard ? 1 : 0) - smallTalkSlots);

  const recId = nanoid();
  const ts = now();
  const cards: CardInfo[] = [];

  // Slice the next unseen batch off the front of the pool, in stored rank order — this is the
  // "refresh = next 4, not random" behavior. Vocab backfill is a defensive safety net only (the
  // pool should already have enough depth via topUpCategory above); it should rarely fire.
  function takeNext(vocab: string[], pooled: string[], category: 'topic' | 'action', slotCount: number, exclude?: Set<string>) {
    const used = new Set<string>();
    const picked: CardInfo[] = [];

    for (const w of pooled) {
      if (picked.length >= slotCount) break;
      const key = w.toLowerCase();
      if (seenLabels.has(key) || used.has(key) || exclude?.has(key)) continue;
      const entry = lookupDyadWord(corpus, w, customWordRows);
      if (!entry) continue; // already validated when appended to the pool; stay defensive anyway
      used.add(key);
      picked.push({
        id: nanoid(), recommendation_id: recId,
        label: entry.name, label_localized: entry.name,
        category, corpus_name: entry.name, corpus_category: entry.category, corpus_image_url: entry.image_url,
        emoji: entry.emoji ?? undefined,
      });
    }

    if (picked.length < slotCount) {
      for (const w of vocab) {
        if (picked.length >= slotCount) break;
        const key = w.toLowerCase();
        if (used.has(key) || seenLabels.has(key) || exclude?.has(key)) continue;
        const entry = lookupDyadWord(corpus, w, customWordRows)!;
        used.add(key);
        picked.push({
          id: nanoid(), recommendation_id: recId,
          label: entry.name, label_localized: entry.name,
          category, corpus_name: entry.name, corpus_category: entry.category, corpus_image_url: entry.image_url,
          emoji: entry.emoji ?? undefined,
        });
      }
    }

    // Last resort: the ENTIRE category vocab has already been shown this turn (the `action`
    // category is only ~39 words — a handful of refreshes exhausts it completely). Without this,
    // every subsequent refresh would silently return fewer and fewer cards, eventually zero,
    // which is exactly the "refresh just stops working after a while" bug — a repeated word is
    // a far better outcome than a missing tile. Still respects `used`/`exclude` (no duplicate
    // within THIS batch), just drops the "not already shown earlier this turn" constraint.
    if (picked.length < slotCount) {
      for (const w of vocab) {
        if (picked.length >= slotCount) break;
        const key = w.toLowerCase();
        if (used.has(key) || exclude?.has(key)) continue;
        const entry = lookupDyadWord(corpus, w, customWordRows)!;
        used.add(key);
        picked.push({
          id: nanoid(), recommendation_id: recId,
          label: entry.name, label_localized: entry.name,
          category, corpus_name: entry.name, corpus_category: entry.category, corpus_image_url: entry.image_url,
          emoji: entry.emoji ?? undefined,
        });
      }
    }

    return picked;
  }

  cards.push(...takeNext(topicVocab, pool.topics, 'topic', topicSlotCount, folderExcludedWords));
  cards.push(...takeNext(actionVocab, pool.actions, 'action', 4));

  // 4 feelings — fixed set, not LLM-generated, so this can never come up short.
  FIXED_FEELINGS.forEach(({ word, phrase }) => {
    const entry = corpus.lookup(word);
    cards.push({
      id: nanoid(),
      recommendation_id: recId,
      label: phrase,
      label_localized: phrase,
      category: 'emotion',
      corpus_name: word,
      corpus_category: entry?.category ?? 'emotion',
      corpus_image_url: entry?.image_url ?? null,
    });
  });

  // 4 core (always-on)
  loadCoreCards().forEach((c) => {
    cards.push({
      id: nanoid(),
      recommendation_id: recId,
      label: c.label,
      label_localized: c.label,
      category: 'core',
    });
  });

  // Self-identification core card — always on, same as Yes/No/I don't know/How about you?,
  // so "introduce yourself" always has a one-tap answer instead of depending on any trigger
  // reliability. Computed inline instead of from the YAML file since there's no static label
  // to substitute into — every dyad's name is different.
  // Kept to "I'm X" (not "My name is X") — the core-card row is a fixed-width tile, and
  // labelSizeClass's smallest tier (its only defense against a long label getting clipped) is
  // already the same one "How about you, mom?" (19 chars) relies on; a 4-word phrase pushed
  // that same tier past what it can render cleanly, especially for longer names.
  cards.push({
    id: nanoid(),
    recommendation_id: recId,
    label: `I'm ${dyad.child_name}`,
    label_localized: `I'm ${dyad.child_name}`,
    category: 'core',
  });

  // Folder cards themselves — resolved above (before the topic words) so the slot math is
  // available in time; just render them into `cards` here.
  folderEntries.forEach((entry) => {
    cards.push({
      id: nanoid(),
      recommendation_id: recId,
      label: entry.label,
      label_localized: entry.label,
      category: 'topic',
      corpus_image_url: entry.icon,
      is_folder: true,
      folder_path: entry.path,
    });
  });

  // Direct age answer card — a plain topic card, not a folder (nothing to browse; the exact
  // value is already known), so it's tappable straight into the sentence like any other word.
  if (pool.showAgeCard) {
    cards.push({
      id: nanoid(),
      recommendation_id: recId,
      label: `I'm ${dyad.age} years old`,
      label_localized: `I'm ${dyad.age} years old`,
      category: 'topic',
      corpus_name: 'age',
    });
  }

  // Small-talk answer card — real corpus entry (already has a proper image), just never
  // surfaced before now since the LLM prompt only ever pulls topic/action vocab.
  if (pool.smallTalk === 'hi' || pool.smallTalk === 'bye' || pool.smallTalk === 'thanks') {
    const word = pool.smallTalk === 'hi' ? 'hello' : pool.smallTalk === 'bye' ? 'goodbye' : 'thank you';
    const label = pool.smallTalk === 'hi' ? 'Hi!' : pool.smallTalk === 'bye' ? 'Bye!' : 'Thank you!';
    const entry = corpus.lookup(word);
    cards.push({
      id: nanoid(),
      recommendation_id: recId,
      label,
      label_localized: label,
      category: 'topic',
      corpus_name: word,
      corpus_category: entry?.category ?? 'core',
      corpus_image_url: entry?.image_url ?? null,
    });
  } else if (pool.smallTalk === 'wellbeing') {
    (['good', 'bad'] as const).forEach((word) => {
      const label = word === 'good' ? 'Good!' : 'Bad!';
      const entry = corpus.lookup(word);
      cards.push({
        id: nanoid(),
        recommendation_id: recId,
        label,
        label_localized: label,
        category: 'topic',
        corpus_name: word,
        corpus_category: entry?.category ?? 'core',
        corpus_image_url: entry?.image_url ?? null,
      });
    });
  }

  await sql`
    INSERT INTO child_card_recommendation (id, session_id, turn_id, cards, pool, timestamp)
    VALUES (${recId}, ${args.sessionId}, ${args.turnId}, ${JSON.stringify(cards)}, ${JSON.stringify(pool)}, ${ts})
  `;

  return { id: recId, timestamp: ts, turn_id: args.turnId, cards };
}

// ---------- submit parent text → switch turn → generate child cards ----------
export async function submitParentMessage(sessionId: string, dyad: Dyad, text: string): Promise<{ turn_id: string; recommendation: ChildCardRecommendationResult }> {
  await ensureSchema();
  const [session, initialCur] = await Promise.all([
    sql`SELECT * FROM session WHERE id = ${sessionId} LIMIT 1` as Promise<any[]>,
    getCurrentTurn(sessionId),
  ]);
  if (!session[0] || session[0].dyad_id !== dyad.id) throw new Error('forbidden');

  let cur = initialCur;
  if (!cur || cur.role !== 'parent') {
    cur = await newTurn(sessionId, 'parent');
  }

  await persistMessage(sessionId, cur.id, 'parent', text, 'text');
  const nextTurn = await switchTurn(sessionId, cur);

  const topic: SessionTopicInfo = {
    category: session[0].topic_category,
    subtopic: session[0].subtopic ?? undefined,
    subtopic_description: session[0].subtopic_description ?? undefined,
  };
  const recommendation = await generateChildCards({
    sessionId, turnId: nextTurn.id, dyad, topic,
  });
  return { turn_id: nextTurn.id, recommendation };
}

// ---------- child interactions ----------
async function getInterimCards(sessionId: string, turnId: string): Promise<CardInfo[]> {
  const r = (await sql`
    SELECT cards FROM interim_card_selection
    WHERE session_id = ${sessionId} AND turn_id = ${turnId}
    LIMIT 1
  `) as any[];
  return r[0]?.cards || [];
}

// Appends one card in a single atomic UPSERT (no read-then-write) — two rapid taps that fire
// overlapping requests would otherwise both read the same starting array and each overwrite
// the other's addition, silently dropping whichever card's write landed first.
async function appendInterimCard(sessionId: string, turnId: string, card: CardInfo): Promise<CardInfo[]> {
  const r = (await sql`
    INSERT INTO interim_card_selection (id, session_id, turn_id, cards, timestamp)
    VALUES (${nanoid()}, ${sessionId}, ${turnId}, ${JSON.stringify([card])}, ${now()})
    ON CONFLICT (session_id, turn_id)
    DO UPDATE SET cards = interim_card_selection.cards || EXCLUDED.cards, timestamp = EXCLUDED.timestamp
    RETURNING cards
  `) as any[];
  return r[0].cards;
}

// Removes by index in a single atomic UPDATE (jsonb `-` operator), same rationale as above.
async function removeInterimCardAtIndex(sessionId: string, turnId: string, index: number): Promise<CardInfo[]> {
  const current = await getInterimCards(sessionId, turnId);
  if (index < 0 || index >= current.length) throw new Error('index out of range');
  const r = (await sql`
    UPDATE interim_card_selection
    SET cards = cards - ${index}::int, timestamp = ${now()}
    WHERE session_id = ${sessionId} AND turn_id = ${turnId}
    RETURNING cards
  `) as any[];
  return r[0].cards;
}

async function getLastChildRec(sessionId: string, turnId: string): Promise<CardInfo[] | null> {
  const r = (await sql`
    SELECT cards FROM child_card_recommendation
    WHERE session_id = ${sessionId} AND turn_id = ${turnId}
    ORDER BY timestamp DESC LIMIT 1
  `) as any[];
  return r[0]?.cards || null;
}

export async function addChildCard(sessionId: string, dyad: Dyad, cardIdentity: { id: string; recommendation_id: string }): Promise<CardSelectionResult> {
  await ensureSchema();
  await assertOwner(sessionId, dyad);
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  // Find the full card by recommendation_id + id
  const rec = (await sql`
    SELECT cards FROM child_card_recommendation
    WHERE id = ${cardIdentity.recommendation_id} LIMIT 1
  `) as any[];
  const allCards: CardInfo[] = rec[0]?.cards || [];
  const card = allCards.find((c) => c.id === cardIdentity.id);
  if (!card) throw new Error('card not in recommendation');

  const interim = await appendInterimCard(sessionId, cur.id, card);

  // Return the existing recommendation unchanged — no LLM regen on tap.
  // Explicit Refresh button is the only trigger for new card generation.
  const lastRecRow = (await sql`
    SELECT * FROM child_card_recommendation
    WHERE session_id = ${sessionId} AND turn_id = ${cur.id}
    ORDER BY timestamp DESC LIMIT 1
  `) as any[];
  const existingRec: ChildCardRecommendationResult = lastRecRow[0]
    ? { id: lastRecRow[0].id, timestamp: Number(lastRecRow[0].timestamp), turn_id: lastRecRow[0].turn_id, cards: lastRecRow[0].cards }
    : { id: nanoid(), timestamp: now(), turn_id: cur.id, cards: [] };

  return { interim_cards: interim, new_recommendation: existingRec };
}

export async function refreshChildCards(sessionId: string, dyad: Dyad): Promise<ChildCardRecommendationResult> {
  await ensureSchema();
  await assertOwner(sessionId, dyad);
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  const [session, interim] = await Promise.all([
    sql`SELECT * FROM session WHERE id = ${sessionId} LIMIT 1` as Promise<any[]>,
    getInterimCards(sessionId, cur.id),
  ]);

  return generateChildCards({
    sessionId, turnId: cur.id, dyad,
    topic: { category: session[0].topic_category, subtopic: session[0].subtopic, subtopic_description: session[0].subtopic_description },
    interimCards: interim,
  });
}

export async function removeChildCardAtIndex(sessionId: string, dyad: Dyad, index: number): Promise<CardSelectionResult> {
  await ensureSchema();
  await assertOwner(sessionId, dyad);
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  const interim = await removeInterimCardAtIndex(sessionId, cur.id, index);

  const lastRec = (await sql`
    SELECT * FROM child_card_recommendation
    WHERE session_id = ${sessionId} AND turn_id = ${cur.id}
    ORDER BY timestamp DESC LIMIT 1
  `) as any[];
  const recRow = lastRec[0];
  const existingRec: ChildCardRecommendationResult = recRow
    ? { id: recRow.id, timestamp: Number(recRow.timestamp), turn_id: recRow.turn_id, cards: recRow.cards }
    : { id: nanoid(), timestamp: now(), turn_id: cur.id, cards: [] };

  return { interim_cards: interim, new_recommendation: existingRec };
}

// ---------- add a free (search-picked) card to interim selection ----------
export async function addFreeCard(
  sessionId: string,
  dyad: Dyad,
  card: { label: string; category: string; image_url: string | null },
): Promise<CardSelectionResult> {
  await ensureSchema();
  await assertOwner(sessionId, dyad);
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  const freeCard: CardInfo = {
    id: nanoid(),
    recommendation_id: 'free',
    label: card.label,
    label_localized: card.label,
    category: card.category as any,
    corpus_name: card.label,
    corpus_image_url: card.image_url,
  };

  const interim = await appendInterimCard(sessionId, cur.id, freeCard);

  const lastRecRow = (await sql`
    SELECT * FROM child_card_recommendation
    WHERE session_id = ${sessionId} AND turn_id = ${cur.id}
    ORDER BY timestamp DESC LIMIT 1
  `) as any[];
  const existingRec: ChildCardRecommendationResult = lastRecRow[0]
    ? { id: lastRecRow[0].id, timestamp: Number(lastRecRow[0].timestamp), turn_id: lastRecRow[0].turn_id, cards: lastRecRow[0].cards }
    : { id: nanoid(), timestamp: now(), turn_id: cur.id, cards: [] };

  return { interim_cards: interim, new_recommendation: existingRec };
}

// ---------- infer full sentence from selected cards ----------
export async function inferSentenceFromCards(sessionId: string, dyad: Dyad): Promise<string> {
  await ensureSchema();
  await assertOwner(sessionId, dyad);
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  const interim = await getInterimCards(sessionId, cur.id);
  if (interim.length === 0) throw new Error('no cards selected');

  // dialogue and the preference-pointer lookup don't depend on each other — fetch concurrently.
  const [dialogue, preferenceRows] = await Promise.all([
    getDialogue(sessionId),
    sql`
      SELECT word FROM dyad_custom_word
      WHERE dyad_id = ${dyad.id} AND is_preference_pointer = TRUE
    ` as unknown as Promise<{ word: string }[]>,
  ]);
  const profileFacts = buildProfileFacts(dyad, preferenceRows.map((r) => r.word));

  const lastParent = [...dialogue].reverse().find(m => m.role === 'parent');
  const lastParentMsg = lastParent && typeof lastParent.content === 'string' ? lastParent.content : undefined;

  // Deliberately NOT passing the full dialogue history here (unlike the other prompts in this
  // file) — buildSentenceInferencePrompt is already self-contained with the tapped cards and
  // the relevant parent message. Passing the whole transcript caused the model to pull in
  // words from *previous* turns' card taps (e.g. inferring "teacher" from turn 1 into a turn-2
  // sentence that only tapped "day"), since it couldn't tell current selection from history.
  const raw = await chat([
    { role: 'system', content: buildSentenceInferencePrompt(interim, dyad.child_name, lastParentMsg, profileFacts) },
    { role: 'user',   content: 'Generate the sentence now, following the rules above.' },
  ]);
  const sentence = raw.replace(/^["'](.*)["']$/s, '$1').trim();
  await sql`UPDATE dialogue_turn SET inferred_sentence = ${sentence} WHERE id = ${cur.id}`;
  return sentence;
}

// Shared by finishChildTurn: asks the LLM for parent-guidance messages covering
// everything the child has said so far and persists the recommendation row.
async function generateParentGuidesForTurn(sessionId: string, dyad: Dyad, nextTurnId: string): Promise<ParentGuideRecommendationResult> {
  const [dialogue, session] = await Promise.all([
    getDialogue(sessionId),
    sql`SELECT * FROM session WHERE id = ${sessionId} LIMIT 1` as Promise<any[]>,
  ]);
  const sysPrompt = buildParentGuidePrompt({
    topic: session[0].topic_category,
    dialogueLength: dialogue.length,
    hasFeedback: false,
  });

  const raw = await chat([
    { role: 'system', content: sysPrompt },
    { role: 'user',   content: dialogueToXml(dialogue) },
  ]);

  const stripped = stripFence(raw);
  let parsed: any[] = [];
  try { parsed = YAML.parse(stripped) || []; } catch (e) {
    console.error('[parent-guides] YAML parse failed:', e, '\nraw:', raw);
  }

  const guides: ParentGuideElement[] = (Array.isArray(parsed) ? parsed : [])
    .slice(0, 3)
    .map((g: any) => ({
      id: nanoid().slice(0, 5),
      category: g.category || 'specification',
      guide: String(g.guide || ''),
      type: 'messaging' as const,
      is_generated: true,
      static_guide_key: null,
    }));

  const recId = nanoid();
  const ts = now();
  await sql`
    INSERT INTO parent_guide_recommendation (id, session_id, turn_id, guides, timestamp)
    VALUES (${recId}, ${sessionId}, ${nextTurnId}, ${JSON.stringify(guides)}, ${ts})
  `;

  return { id: recId, timestamp: ts, turn_id: nextTurnId, guides };
}

// ---------- confirm child cards → bank as one sentence → stay on child's turn ----------
// The child can call this repeatedly (pick cards, generate, accept) to say several
// sentences in a row; the turn only hands off to the parent once they tap "Done"
// (see finishChildTurn below).
export async function confirmChildCardSelection(sessionId: string, dyad: Dyad): Promise<{ turn_id: string; recommendation: ChildCardRecommendationResult }> {
  await ensureSchema();
  await assertOwner(sessionId, dyad);
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  const [interim, session] = await Promise.all([
    getInterimCards(sessionId, cur.id),
    sql`SELECT * FROM session WHERE id = ${sessionId} LIMIT 1` as Promise<any[]>,
  ]);
  if (interim.length === 0) throw new Error('no cards selected');

  await persistMessage(sessionId, cur.id, 'child', interim, 'cards');

  const topic: SessionTopicInfo = {
    category: session[0].topic_category,
    subtopic: session[0].subtopic ?? undefined,
    subtopic_description: session[0].subtopic_description ?? undefined,
  };

  const nextTurn = await continueTurnAsChild(sessionId, cur);
  const recommendation = await generateChildCards({ sessionId, turnId: nextTurn.id, dyad, topic });

  return { turn_id: nextTurn.id, recommendation };
}

// ---------- finish child's turn(s) → switch to parent → generate parent guides ----------
export async function finishChildTurn(sessionId: string, dyad: Dyad): Promise<{ turn_id: string; recommendation: ParentGuideRecommendationResult }> {
  await ensureSchema();
  await assertOwner(sessionId, dyad);
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  const nextTurn = await switchTurn(sessionId, cur);
  const recommendation = await generateParentGuidesForTurn(sessionId, dyad, nextTurn.id);
  return { turn_id: nextTurn.id, recommendation };
}

// ---------- parent example utterance (per messaging guide) ----------
export async function requestParentExample(
  sessionId: string, dyad: Dyad, recommendationId: string, guideId: string,
): Promise<{ id: string; timestamp: number; recommendation_id: string; guide_id: string; message: string; message_localized?: string }> {
  await ensureSchema();

  const recRows = (await sql`
    SELECT id, guides FROM parent_guide_recommendation
    WHERE id = ${recommendationId} AND session_id = ${sessionId}
    LIMIT 1
  `) as any[];
  if (!recRows[0]) throw new Error('recommendation not found');
  const guides: ParentGuideElement[] = recRows[0].guides;
  const guide = guides.find((g) => g.id === guideId);
  if (!guide) throw new Error('guide not in recommendation');

  const dialogue = await getDialogue(sessionId);
  const dialogueXml = dialogueToXml(dialogue);
  const sysPrompt = `Given a parent-child dialogue and a guide, write ONE short parent utterance (≤8 words) that follows the guide. Output ONLY the utterance, no quotes or labels.`;
  const raw = await chat([
    { role: 'system', content: sysPrompt },
    { role: 'user',   content: `${dialogueXml}\n<message_generation_guide>${guide.guide}</message_generation_guide>` },
  ]);
  const message = raw.replace(/^["'](.*)["']$/s, '$1').trim();

  return {
    id: nanoid(),
    timestamp: now(),
    recommendation_id: recommendationId,
    guide_id: guideId,
    message,
    message_localized: dyad.locale === 'en' ? message : undefined,
  };
}

// ---------- session housekeeping ----------
export async function endSession(sessionId: string, dyad: Dyad): Promise<void> {
  await ensureSchema();

  // Best-effort AI caption for the history list — a failed/slow LLM call should never block
  // ending the session, so title stays null and the UI falls back to the topic label.
  let title: string | null = null;
  try {
    const dialogue = await getDialogue(sessionId);
    if (dialogue.length > 0) {
      const raw = await chat([
        { role: 'system', content: buildSessionTitlePrompt(dyad.child_name) },
        { role: 'user', content: dialogueToXml(dialogue) },
      ]);
      title = raw.replace(/^["'](.*)["']$/s, '$1').trim() || null;
    }
  } catch (e) {
    console.error('[session-title] generation failed:', e);
  }

  await sql`
    UPDATE session SET status = 'terminated', ended_timestamp = ${now()}, title = COALESCE(${title}, title)
    WHERE id = ${sessionId} AND dyad_id = ${dyad.id}
  `;
}

export async function abortSession(sessionId: string, dyad: Dyad): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM session WHERE id = ${sessionId} AND dyad_id = ${dyad.id}`;
}
