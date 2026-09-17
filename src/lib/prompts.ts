/**
 * Prompt builders still used by the live path (session lifecycle only — see moderator.ts).
 * The card-generation/sentence-inference/parent-guide prompts that used to live here were
 * removed 2026-09-17 along with the rest of the dead cloud-LLM child-turn flow.
 */
import type { DialogueMessage } from './types';

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

// ---------- SessionTitleGenerator ----------
export function buildSessionTitlePrompt(childName: string): string {
  return [
    `Given a parent-child dialogue, write ONE short title (3-6 words) that captures what ${childName} `,
    `talked about — like a caption a parent could scan later to remember this conversation.\n`,
    `Use plain, warm language, not a generic label like "Daily chat".\n`,
    `Output ONLY the title, no quotes, no punctuation at the end.`,
  ].join('');
}
