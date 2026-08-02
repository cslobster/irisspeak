/**
 * Prompt builders — one per LLM task. Mirrors libs/py_core/py_core/system/task/*
 * after the latest prompt-trimming pass.
 */
import { TOPIC_DESCRIPTION } from './staticData';
import type { FolderCardOption } from './staticData';
import type {
  CardInfo, DialogueMessage, TopicCategory,
} from './types';

// ---------- dialogue → XML transcript ----------
export function dialogueToXml(dialogue: DialogueMessage[], inspectLast = false): string {
  const lines = dialogue.map((m, i) => {
    const isLast = i === dialogue.length - 1;
    const tag = inspectLast && isLast && m.role === 'parent' ? ' inspect="true"' : '';
    let body: string;
    if (typeof m.content === 'string') body = m.content;
    else body = m.content.map((c) => `[${c.label}]`).join(' ');
    return `\t<msg role="${m.role}"${tag}>${escapeXml(body)}</msg>`;
  });
  return `<dialogue>\n${lines.join('\n')}\n</dialogue>`;
}

function escapeXml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// ---------- ChildCardRecommendationGenerator ----------
export function buildChildCardPrompt(args: {
  topic: TopicCategory;
  topicVocab: string[];
  actionVocab: string[];
  seenLabels?: string[];
  interimCards?: CardInfo[];
  folderOptions?: FolderCardOption[];
  profileFacts?: string;
}): string {
  const topicList = args.topicVocab.join(', ');
  const actionList = args.actionVocab.join(', ');

  // Always included in full when present — never conditionally retrieved or gated behind
  // keyword matching (see CONTEXT.md's Profile Fact entry for why: a missed fact still falls
  // back to the "View all words" search overlay, so it doesn't need Folder Card's
  // hardcoded-backstop-level reliability). Placed before theme identification so the model can
  // naturally connect an implied reference to a stored fact without needing literal keywords.
  const profileContext = args.profileFacts
    ? `What you know about this child: ${args.profileFacts}\n\n`
    : '';

  let folderInstructions = '';
  if (args.folderOptions && args.folderOptions.length) {
    const folderList = args.folderOptions.map((f) => f.path).join(', ');
    folderInstructions = [
      `\n\n4. Alongside step 3, check whether the theme from step 1 is really an open-ended set `,
      `that the fixed 12-word topic/action lists can only ever approximate — e.g. a specific `,
      `number, color, animal, sport, food, drink, toy, place, family member, time, or weather `,
      `condition. This is a NORMAL, common case, not a rare exception — whenever the true answer `,
      `could be any value in one of these categories, a fixed word is only ever a guess at which `,
      `one, while the folder gives the child the FULL real set to pick the exact one themselves. `,
      `In that case you MUST ALSO output a \`folder\` line naming exactly one of: ${folderList} `,
      `(name a second one, comma-separated in the same brackets, only if the message `,
      `unambiguously asks for two of these at once — e.g. "what time and what day"). Add the `,
      `folder line EVEN IF one or two topic/action words above already loosely touch on it — `,
      `don't skip it just because the fixed list happens to contain one plausible-looking word `,
      `(e.g. topic vocab containing the word "five" is not a reason to skip the Numbers folder `,
      `when the real question is "how old are you", since the true answer isn't necessarily five). `,
      `Only skip the folder line when the theme is genuinely NOT one of these open-ended `,
      `categories (e.g. a yes/no intent, or a feeling) — in that case a fixed word is the right `,
      `call and no folder applies. Never invent a folder name outside this exact list. Decide `,
      `this silently, like steps 1-3 — do NOT explain your reasoning for it. The \`folder\` line, `,
      `if used, MUST be formatted exactly as \`folder: [path]\` or \`folder: [path1, path2]\` with `,
      `square brackets, on a single line, and nothing else — the same as the topics/actions lines `,
      `below.`,
    ].join('');
  }

  let prev = '';
  if (args.seenLabels && args.seenLabels.length) {
    prev = `\nAvoid ALL of these (already shown this turn): ${args.seenLabels.join(', ')}.`;
  }

  let interim = '';
  if (args.interimCards && args.interimCards.length) {
    interim = `\nChild already picked: ${args.interimCards.map((c) => c.label).join(', ')}. Make next set fit.`;
  }

  return [
    `You suggest AAC card words for a child age 5–7 with ASD, talking with their parent. `,
    `Conversation: ${TOPIC_DESCRIPTION[args.topic]}\n\n`,
    profileContext,
    `Given the dialogue's last parent message:\n`,
    `1. Identify the specific theme of that message — what kind of answer is it actually asking for `,
    `(e.g. a food, an activity, a place, a person, a time)? Stay locked onto that theme; do not drift `,
    `into unrelated topics unless the message is actually about them.\n`,
    `2. Think of 2-3 short sentences the child might want to say that directly and specifically answer `,
    `the message, staying strictly on that theme.\n`,
    `3. From those sentences, pick 12 topic nouns and 12 action verbs, chosen ONLY from the fixed `,
    `vocabularies below — do not invent new words or use words outside these lists. List each set of `,
    `12 in order from most-fitting to least-fitting, since only the first few valid ones may get shown `,
    `now and the rest are kept in reserve for a later refresh:\n`,
    `   Topic vocabulary: ${topicList}\n`,
    `   Action vocabulary: ${actionList}\n\n`,
    `Every topic/action word must relate directly and specifically to the theme from step 1, not `,
    `just loosely associated filler. In particular, generic time words (now, today, time, morning, `,
    `day, tomorrow, later) are an easy but usually WRONG default when the model is unsure what else `,
    `fits — only include a time word if the message is actually asking about time, schedule, or `,
    `"when", never as filler for an unrelated theme just because it's broadly plausible. If a `,
    `vocabulary doesn't contain enough strongly on-theme words, pick the closest available ones `,
    `rather than switching to a different theme or reaching for generic filler. Do NOT repeat the `,
    `same word twice within a list.\n\n`,
    folderInstructions,
    `\n\nDo ALL steps silently — do NOT write out the theme, sentences, or any reasoning about `,
    `the folder decision. Output ONLY this YAML, nothing else, no text before or after it, no `,
    `explanation:\n`,
    `topics: [w1, w2, ..., w12]\n`,
    `actions: [w1, w2, ..., w12]`,
    args.folderOptions && args.folderOptions.length
      ? `\n(include a third line \`folder: [path]\` whenever step 4 identifies an open-ended theme — omit it only when the theme genuinely isn't one)`
      : '',
    prev,
    interim,
  ].join('');
}

// ---------- ParentGuideRecommendationGenerator ----------
export function buildParentGuidePrompt(args: {
  topic: TopicCategory;
  dialogueLength: number;
  hasFeedback: boolean;
}): string {
  const guideCount = args.hasFeedback ? 2 : 3;
  const taskLine = args.dialogueLength > 0
    ? `Suggest guides for how the parent should respond to the child's last keyword message.`
    : `Suggest opening guides for the parent.`;

  return [
    `You help a parent talk with their minimally-verbal autistic child.\n`,
    `Topic: ${TOPIC_DESCRIPTION[args.topic]}\n`,
    `${taskLine}\n\n`,
    `Rules:\n`,
    `- Each guide ≤6 words, one intent each.\n`,
    `- Pick ${guideCount} categories from this list:\n`,
    `  - "intention": Check what the child wants or means.\n`,
    `  - "specification": Ask about a specific detail.\n`,
    `  - "choice": Offer a choice between options.\n`,
    `  - "clues": Help the child remember or recall.\n`,
    `  - "coping": Empathize and validate the child's feeling.\n`,
    `  - "stimulate": Suggest a related topic to expand the conversation.\n`,
    `  - "share": Share your own related experience.\n`,
    `  - "empathize": Mirror the child's emotion.\n`,
    `  - "encourage": Affirm and support what the child is doing.\n`,
    `  - "emotion": Ask about how the child feels.\n`,
    `  - "extend": Add a new but related angle.\n`,
    `  - "terminate": Wrap up the topic gently.\n\n`,
    `Output ONLY a YAML list, nothing else. Each item:\n`,
    `- category: <one of the categories above>\n`,
    `  guide: <short guide for the parent>`,
  ].join('');
}

// ---------- ParentExampleMessageGenerator ----------
export function buildParentExamplePrompt(): string {
  return `Given a parent-child dialogue and a guide, write ONE short parent utterance (≤8 words) that follows the guide.\nOutput ONLY the utterance, no quotes or labels.`;
}

// ---------- SessionTitleGenerator ----------
export function buildSessionTitlePrompt(childName: string): string {
  return [
    `Given a parent-child dialogue, write ONE short title (3-6 words) that captures what ${childName} `,
    `talked about — like a caption a parent could scan later to remember this conversation.\n`,
    `Use plain, warm language, not a generic label like "Daily chat".\n`,
    `Output ONLY the title, no quotes, no punctuation at the end.`,
  ].join('');
}

// ---------- SentenceInferenceGenerator ----------
export function buildSentenceInferencePrompt(
  cards: CardInfo[],
  childName: string,
  lastParentMessage?: string,
): string {
  const content = cards.filter(c => c.category === 'topic' || c.category === 'action');
  const emotions = cards.filter(c => c.category === 'emotion');
  const core = cards.filter(c => c.category === 'core');

  const contentWords = content.map(c => c.corpus_name || c.label);
  const emotionWords = emotions.map(c => c.corpus_name || c.label);
  const coreLabels = core.map(c => c.label);
  const hasCoreCard = core.length > 0;

  // Collapse repeat taps of the same card into one entry with a tap count instead of showing
  // the raw word multiple times — otherwise the model tends to echo it back literally
  // ("felt happy and happy all day") rather than reading repetition as emphasis.
  function summarizeWords(words: string[]): string {
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (const w of words) {
      if (!counts.has(w)) order.push(w);
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    return order.map(w => (counts.get(w)! > 1 ? `${w} (tapped ${counts.get(w)}x)` : w)).join(', ');
  }

  const lines: string[] = [
    `You interpret what a minimally-verbal autistic child named ${childName} is trying to say using AAC cards.`,
  ];

  if (lastParentMessage) {
    lines.push(``, `The parent just said: "${lastParentMessage}"`);
  }

  lines.push(
    ``,
    `${childName} tapped these AAC cards (in order, first tapped = most emphasized):`,
  );
  if (contentWords.length) lines.push(`  Content (topic/action): ${summarizeWords(contentWords)}`);
  if (emotionWords.length) lines.push(`  Feeling: ${summarizeWords(emotionWords)}`);
  if (coreLabels.length)   lines.push(`  Core (Yes/No/More/Help/etc): ${coreLabels.join(', ')}`);

  lines.push(
    ``,
    `Write ONE natural first-person sentence that captures what ${childName} means.`,
    ``,
    `RULES:`,
    `1. ${hasCoreCard ? `Core word "${coreLabels.join('/')}" goes at the very start and drives the tone.` : `No core card tapped — do NOT start with Yes, No, or any affirmation. Begin with "I".`}`,
    `2. Use the parent's question as context — if the parent asked about food, you don't need to re-explain food; just answer about it.`,
    `3. EVERY DISTINCT tapped card must be represented in the sentence — none may be dropped or left out, even if that makes the sentence a bit longer or less smooth. Build the sentence in tap order (first-tapped card's idea comes first), connected with natural prepositions/conjunctions (at, in, on, with, and, because, so) — don't just list words with "and".`,
    `4. If a feeling card is present, weave it in naturally ("I feel X" or "I'm X") — do not let it replace or crowd out the other cards.`,
    `5. 4–10 words. ONE sentence only. First-person.`,
    `6. Do NOT invent any idea, reason, person, place, or detail that isn't one of the tapped cards or explicitly in the parent's question. If you're unsure how two cards connect, use a plain "and" rather than inventing a connecting reason.`,
    `7. A card marked "(tapped Nx)" means ${childName} tapped it multiple times for EMPHASIS — express that as intensity ("really", "so", "very") ONCE, not by repeating the word N times.`,
    `8. Before answering, silently check your draft sentence against the card list — if any distinct card's word or clear meaning is missing, revise until every one is present, and make sure no word is repeated more than the emphasis in rule 7 calls for. Output ONLY the final sentence — no quotes, no explanation, no draft.`,
    ``,
    `Examples WITH parent context:`,
    `  Parent: "What do you want to eat?" | Cards: [pizza, want, more] → I want more pizza`,
    `  Parent: "Are you okay?" | Cards: [No, hurt, stomach] → No, my stomach hurts`,
    `  Parent: "Do you want to go out?" | Cards: [Yes, park, swing, play] → Yes, I want to play on the swings at the park`,
    `  Parent: "How was school today?" | Cards: [friend, play, happy] → I played with a friend and felt happy`,
    `  Parent: "Are you done eating?" | Cards: [No, more, cookie] → No, I want more cookies`,
    `  Parent: "Where does it hurt?" | Cards: [hurt, tummy] → My tummy hurts`,
    `  Parent: "What do you want to do?" | Cards: [home, go, tired] → I'm tired and want to go home`,
    ``,
    `Examples WITHOUT parent context (child initiates):`,
    `  Cards: [hungry, food] → I'm hungry and want food`,
    `  Cards: [sad, help] → I feel sad and need help`,
    `  Cards: [play, outside, happy] → I want to play outside and I feel happy`,
    `  Cards: [want, sleep, confused] → I'm confused and want to sleep`,
    `    (BAD — do not do this: "I'm confused about leaving" — drops "want"/"sleep" and invents "leaving")`,
    `  Feeling: happy (tapped 3x) → I feel really happy`,
    `    (BAD — do not do this: "I felt happy and happy all day" — repeats the word instead of using intensity)`,
  );

  return lines.join('\n');
}

// ---------- DialogueInspector ----------
export function buildInspectorPrompt(): string {
  return [
    `Inspect the parent's last message (marked inspect="true") in a dialogue with their autistic child.\n\n`,
    `Categories (use only these labels):\n`,
    `- "blame": The parent is scolding the child.\n`,
    `- "correction": The parent is correcting the child's speech.\n`,
    `- "complex": The parent asks two or more questions at once.\n\n`,
    `Output ONLY this JSON, nothing else:\n`,
    `{"categories": [<labels or []>], "rationale": <short>, "feedback": <short tip>}`,
  ].join('');
}
