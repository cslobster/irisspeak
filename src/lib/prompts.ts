/**
 * Prompt builders — one per LLM task. Mirrors libs/py_core/py_core/system/task/*
 * after the latest prompt-trimming pass.
 */
import { EMOTION_LABELS, TOPIC_DESCRIPTION } from './staticData';
import type {
  CardInfo, DialogueMessage, ParentType, TopicCategory,
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
  parentType: ParentType;
  topic: TopicCategory;
  seenLabels?: string[];
  interimCards?: CardInfo[];
}): string {
  const emotionList = EMOTION_LABELS.join(', ');

  let prev = '';
  if (args.seenLabels && args.seenLabels.length) {
    prev = `\nAvoid ALL of these (already shown this turn): ${args.seenLabels.join(', ')}.`;
  }

  let interim = '';
  if (args.interimCards && args.interimCards.length) {
    interim = `\nChild already picked: ${args.interimCards.map((c) => c.label).join(', ')}. Make next set fit.`;
  }

  return [
    `Child age 5–7 with ASD, talking with their ${args.parentType.toLowerCase()}. `,
    `Conversation: ${TOPIC_DESCRIPTION[args.topic]}\n`,
    `Silently consider what the child's next sentence or question would be, and the key nouns `,
    `and verbs they'd need to say it. Do not write out this reasoning.\n`,
    `Given the dialogue's last parent message, output 4 topic nouns, 4 action verbs, `,
    `and 4 emotions chosen from this fixed list: ${emotionList}.\n`,
    `Output ONLY the YAML below, nothing else — no reasoning, no bullet points, no explanation:\n`,
    `topics: [w1, w2, w3, w4]\n`,
    `actions: [w1, w2, w3, w4]\n`,
    `emotions: [w1, w2, w3, w4]`,
    prev,
    interim,
  ].join('');
}

// ---------- ParentGuideRecommendationGenerator ----------
export function buildParentGuidePrompt(args: {
  parentType: ParentType;
  topic: TopicCategory;
  dialogueLength: number;
  hasFeedback: boolean;
}): string {
  const guideCount = args.hasFeedback ? 2 : 3;
  const taskLine = args.dialogueLength > 0
    ? `Suggest guides for how the ${args.parentType} should respond to the child's last keyword message.`
    : `Suggest opening guides for the ${args.parentType}.`;

  return [
    `You help a ${args.parentType} talk with their minimally-verbal autistic child.\n`,
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
    `  guide: <short guide for the ${args.parentType}>`,
  ].join('');
}

// ---------- ParentExampleMessageGenerator ----------
export function buildParentExamplePrompt(): string {
  return `Given a parent-child dialogue and a guide, write ONE short parent utterance (≤8 words) that follows the guide.\nOutput ONLY the utterance, no quotes or labels.`;
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
  if (contentWords.length) lines.push(`  Content (topic/action): ${contentWords.join(', ')}`);
  if (emotionWords.length) lines.push(`  Feeling: ${emotionWords.join(', ')}`);
  if (coreLabels.length)   lines.push(`  Core (Yes/No/More/Help/etc): ${coreLabels.join(', ')}`);

  lines.push(
    ``,
    `Write ONE natural first-person sentence that captures what ${childName} means.`,
    ``,
    `RULES:`,
    `1. ${hasCoreCard ? `Core word "${coreLabels.join('/')}" goes at the very start and drives the tone.` : `No core card tapped — do NOT start with Yes, No, or any affirmation. Begin with "I".`}`,
    `2. Use the parent's question as context — if the parent asked about food, you don't need to re-explain food; just answer about it.`,
    `3. Capture the MEANING of all the cards. Use natural prepositions (at, in, on, with) to connect them — don't just list words with "and".`,
    `4. If a feeling card is present, weave it in naturally ("I feel X" or "I'm X").`,
    `5. 4–10 words. ONE sentence only. First-person.`,
    `6. Do NOT invent ideas that aren't in the cards or the parent's question.`,
    `7. Output ONLY the sentence — no quotes, no explanation.`,
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
