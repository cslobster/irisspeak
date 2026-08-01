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
import { buildInitialGuides, labelForParent, loadCoreCards, loadFolderCards } from './staticData';
import type { FolderCardOption } from './staticData';
import type {
  CardInfo, CardSelectionResult, ChildCardRecommendationResult, DialogueMessage, Dyad,
  ParentGuideElement, ParentGuideRecommendationResult, SessionTopicInfo, TopicCategory,
} from './types';

// Deterministic backstop for the LLM's folder-card judgment call: even with a strongly-worded
// prompt, Gemini doesn't reliably suggest a folder for the most obvious cases (empirically,
// misses "How old are you?" a meaningful fraction of the time — see CONTEXT.md's Folder Card
// entry). These keyword patterns catch the unambiguous canonical phrasings per allow-listed
// folder so the feature isn't purely a coin flip for the cases it exists to solve.
const FOLDER_KEYWORD_TRIGGERS: { pattern: RegExp; path: string }[] = [
  { pattern: /\bhow old\b|\byour age\b|\bwhat age\b/i, path: 'numbers' },
  { pattern: /\bcolor\b|\bcolour\b/i, path: 'describe > colours' },
  { pattern: /\bfamily member\b|\bfavorite family\b/i, path: 'people > family' },
  { pattern: /\bwhat time\b/i, path: 'time' },
  { pattern: /\bweather\b/i, path: 'weather' },
];

// Every message gets at most this many folder cards — keeps folder suggestions rare and the
// topic column mostly real words, per product intent (folders are for the clear-cut cases only).
const MAX_FOLDER_CARDS = 2;

function detectFoldersByKeyword(text: string, folderOptions: FolderCardOption[]): FolderCardOption[] {
  const matches: FolderCardOption[] = [];
  for (const { pattern, path } of FOLDER_KEYWORD_TRIGGERS) {
    if (pattern.test(text)) {
      const entry = folderOptions.find((f) => f.path === path);
      if (entry) matches.push(entry);
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
  const guides = buildInitialGuides(sess.topic_category as TopicCategory, dyad.child_name, dyad.parent_type as any);

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
      SELECT cards FROM child_card_recommendation
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

  // See CONTEXT.md's Profile Fact entry — always included in full, never gated, so the model
  // can connect an implied reference (e.g. "which hue do you like") to a stored fact without
  // literal keyword matching. Preference-pointer custom words (e.g. "favorite color: red") are
  // folded in here rather than the vocab list, since the word itself already exists there.
  const preferencePointers = customWordRows.filter((w) => w.is_preference_pointer).map((w) => w.word);
  const factParts: string[] = [];
  if (dyad.age != null) factParts.push(`age ${dyad.age}`);
  if (dyad.communication_style) factParts.push(`communicates via ${dyad.communication_style}`);
  if (preferencePointers.length) factParts.push(`known favorites: ${preferencePointers.join(', ')}`);
  if (dyad.notes) factParts.push(dyad.notes);
  const profileFacts = factParts.length ? factParts.join('; ') : undefined;

  const sysPrompt = buildChildCardPrompt({
    parentType: dyad.parent_type,
    topic: args.topic.category,
    topicVocab,
    actionVocab,
    seenLabels: [...seenLabels],
    interimCards: args.interimCards,
    folderOptions,
    profileFacts,
  });

  const raw = await chat([
    { role: 'system', content: sysPrompt },
    { role: 'user',   content: dialogueToXml(dialogue) },
  ]);

  // Extract the topics/actions/emotions lines directly rather than requiring the whole
  // response to be valid YAML — Gemini sometimes writes its reasoning out as prose before the
  // structured output despite being told not to, which would break a strict whole-document
  // parse even though the YAML we actually want is sitting right there intact.
  //
  // Requested 6 ranked candidates per topic/action category (see buildChildCardPrompt) — the
  // model's own theme-relevant 5th/6th choices backstop the common case where its top pick or
  // two (e.g. "eat", "want") aren't actually in the fixed vocab, without falling back to
  // arbitrary words.
  const topics  = extractYamlList(raw, 'topics').slice(0, 6);
  const actions = extractYamlList(raw, 'actions').slice(0, 6);
  const folderPicks = extractYamlList(raw, 'folder').slice(0, MAX_FOLDER_CARDS);

  const recId = nanoid();
  const ts = now();
  const cards: CardInfo[] = [];

  // Folder card(s) (e.g. "Numbers") — resolved BEFORE the topic words below because each one
  // takes one of the 4 topic slots (rather than adding a 5th/6th tile), so the topic-word
  // resolution needs to know how many slots are left. Sourced from whichever of the LLM's picks
  // are actually in the curated allow-list (anything else, e.g. a hallucinated name, is dropped)
  // PLUS a deterministic keyword match against the parent's last message (see
  // FOLDER_KEYWORD_TRIGGERS) so obvious cases don't depend purely on the LLM remembering to
  // suggest one. Deduped by path, capped at MAX_FOLDER_CARDS. Folders are meant to be rare — most
  // turns should have zero — so this only ever trims topic slots down, never adds extra tiles.
  const folderEntries: FolderCardOption[] = [];
  const usedFolderPaths = new Set<string>();
  for (const pick of folderPicks) {
    const entry = folderOptions.find((f) => f.path.toLowerCase() === pick.toLowerCase());
    if (!entry) {
      console.warn(`[child-cards] folder "${pick}" not in allow-list — dropping`);
      continue;
    }
    if (usedFolderPaths.has(entry.path)) continue;
    usedFolderPaths.add(entry.path);
    folderEntries.push(entry);
  }
  if (folderEntries.length < MAX_FOLDER_CARDS) {
    const lastParentMsg = [...dialogue].reverse().find((m) => m.role === 'parent' && typeof m.content === 'string');
    if (lastParentMsg) {
      for (const entry of detectFoldersByKeyword(lastParentMsg.content as string, folderOptions)) {
        if (folderEntries.length >= MAX_FOLDER_CARDS) break;
        if (usedFolderPaths.has(entry.path)) continue;
        usedFolderPaths.add(entry.path);
        folderEntries.push(entry);
      }
    }
  }
  // A folder card already covers its own contents (e.g. "Numbers" covers "five", "six", ...) —
  // don't also offer those same words loose in the topic column, or the child sees the same
  // answer twice.
  const folderExcludedWords = new Set(folderEntries.flatMap((f) => f.words.map((w) => w.toLowerCase())));
  const topicSlotCount = Math.max(0, 4 - folderEntries.length);

  // The LLM was given the exact vocab list and 6 ranked slots per category, so it has room to
  // fall through to a real synonym when its top pick (e.g. "eat") isn't actually in the fixed
  // vocab. Look each candidate up in rank order and take the first N valid ones; anything
  // hallucinated gets dropped. Backfill from the vocab only covers the rare case where fewer
  // than N of the 6 candidates resolved.
  function resolveCategory(words: string[], vocab: string[], category: 'topic' | 'action', slotCount: number, exclude?: Set<string>) {
    const used = new Set<string>();
    const picked: CardInfo[] = [];

    for (const w of words) {
      if (picked.length >= slotCount) break;
      // Falls through to this dyad's Custom Vocabulary Words before giving up — otherwise a
      // word the LLM correctly picked from the vocab list it was given would get silently
      // dropped as "hallucinated" just because the shared corpus doesn't recognize it (see
      // CONTEXT.md's Custom Vocabulary Word entry — this is the exact gotcha flagged at design
      // time, not a hypothetical).
      const entry = lookupDyadWord(corpus, w, customWordRows);
      if (!entry) {
        console.warn(`[child-cards] "${w}" not in corpus vocab — dropping`);
        continue;
      }
      const key = entry.name.toLowerCase();
      if (used.has(key) || exclude?.has(key)) continue; // duplicate pick from the LLM, or covered by a folder card
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

    return picked;
  }

  cards.push(...resolveCategory(topics.map(String), topicVocab, 'topic', topicSlotCount, folderExcludedWords));
  cards.push(...resolveCategory(actions.map(String), actionVocab, 'action', 4));

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
      label: labelForParent(c, dyad.parent_type),
      label_localized: labelForParent(c, dyad.parent_type),
      category: 'core',
    });
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

  await sql`
    INSERT INTO child_card_recommendation (id, session_id, turn_id, cards, timestamp)
    VALUES (${recId}, ${args.sessionId}, ${args.turnId}, ${JSON.stringify(cards)}, ${ts})
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
  const cur = await getCurrentTurn(sessionId);
  if (!cur || cur.role !== 'child') throw new Error('not child turn');

  const interim = await getInterimCards(sessionId, cur.id);
  if (interim.length === 0) throw new Error('no cards selected');
  const dialogue = await getDialogue(sessionId);

  const lastParent = [...dialogue].reverse().find(m => m.role === 'parent');
  const lastParentMsg = lastParent && typeof lastParent.content === 'string' ? lastParent.content : undefined;

  // Deliberately NOT passing the full dialogue history here (unlike the other prompts in this
  // file) — buildSentenceInferencePrompt is already self-contained with the tapped cards and
  // the relevant parent message. Passing the whole transcript caused the model to pull in
  // words from *previous* turns' card taps (e.g. inferring "teacher" from turn 1 into a turn-2
  // sentence that only tapped "day"), since it couldn't tell current selection from history.
  const raw = await chat([
    { role: 'system', content: buildSentenceInferencePrompt(interim, dyad.child_name, lastParentMsg) },
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
    parentType: dyad.parent_type,
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
