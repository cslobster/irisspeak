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
  prevCards?: CardInfo[];
  interimCards?: CardInfo[];
}): string {
  const emotionList = EMOTION_LABELS.join(', ');

  let prev = '';
  if (args.prevCards && args.prevCards.length) {
    const labels = args.prevCards
      .filter((c) => c.category === 'topic' || c.category === 'action')
      .map((c) => c.label)
      .slice(0, 8);
    if (labels.length) prev = `\nAvoid repeating: ${labels.join(', ')}.`;
  }

  let interim = '';
  if (args.interimCards && args.interimCards.length) {
    interim = `\nChild already picked: ${args.interimCards.map((c) => c.label).join(', ')}. Make next set fit.`;
  }

  return [
    `You suggest English keywords for an AAC card UI. `,
    `Child age 5–7 with ASD, talking with their ${args.parentType.toLowerCase()}. `,
    `Conversation: ${TOPIC_DESCRIPTION[args.topic]}\n`,
    `Given the dialogue's last parent message, output 4 topic nouns, 4 action verbs, `,
    `and 4 emotions chosen from this fixed list: ${emotionList}.\n`,
    `Output ONLY this YAML, nothing else:\n`,
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
