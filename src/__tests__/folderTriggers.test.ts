import { describe, it, expect, vi } from 'vitest';

// moderator.ts imports db.ts at module scope, which throws without DATABASE_URL — this test
// only exercises the pure detectFoldersByKeyword function, so a no-op mock is enough.
vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  sql: vi.fn(),
}));

import { detectFoldersByKeyword } from '@/lib/moderator';
import { loadFolderCards } from '@/lib/staticData';

// Exercises the real data/folder_cards.yml + the real detectFoldersByKeyword against a batch of
// realistic parent questions — the exact kind of reliability check requested: common questions a
// parent/child dyad would actually ask, not synthetic keyword fragments.
const folderOptions = loadFolderCards();

function foldersFor(message: string): string[] {
  return detectFoldersByKeyword(message, folderOptions).map((f) => f.path);
}

describe('folder keyword triggers — realistic parent questions', () => {
  it('has 35 curated folders available (5 original + 30 added across two expansion passes)', () => {
    expect(folderOptions.length).toBe(35);
  });

  const expectedHits: { question: string; path: string }[] = [
    // Original 5
    { question: 'How old are you?', path: 'numbers' },
    { question: "What's your favorite color?", path: 'describe > colours' },
    { question: 'Who is your favorite family member?', path: 'people > family' },
    { question: 'What time is it?', path: 'time' },
    { question: 'How is the weather today?', path: 'weather' },
    // First expansion pass (9)
    { question: "What's your favorite sport?", path: 'sports' },
    { question: "What's your favorite ice cream flavor?", path: 'snacks' },
    { question: "What's your favorite drink?", path: 'drinks' },
    { question: "What's your favorite animal?", path: 'animals' },
    { question: "What's your favorite toy?", path: 'toys' },
    { question: 'What do you want to eat?', path: 'food' },
    { question: 'How do you get to school?', path: 'transport' },
    { question: 'Where do you want to go?', path: 'places' },
    { question: 'What do you want to wear today?', path: 'clothing' },
    // Second expansion pass (21) — full coverage of every folder that fits the
    // "one specific answer out of an open set" pattern (excludes Root, quick chat, position,
    // questions, top-level describe, emotions, and actions — see CONTEXT.md's Folder Card entry
    // for why those seven are deliberately left out).
    { question: "What's your favorite gadget?", path: 'technology' },
    { question: "What's your favorite furniture?", path: 'furniture' },
    { question: 'Time to get ready for bed', path: 'hygiene' },
    { question: 'Can you help set the table?', path: 'kitchen' },
    { question: "What's your favorite flower?", path: 'plants' },
    { question: 'Do you have your school supplies?', path: 'school' },
    { question: 'What do you want to do today?', path: 'activities' },
    { question: 'Where does it hurt?', path: 'body' },
    { question: 'Who do you want to see today?', path: 'people' },
    { question: "What's your favorite character?", path: 'people > characters' },
    { question: 'Which country do you want to visit?', path: 'places > countries' },
    { question: "What's your favorite bird?", path: 'animals > birds' },
    { question: "What's your favorite bug?", path: 'animals > insects' },
    { question: "What's your favorite sea animal?", path: 'animals > marine animals' },
    { question: "What's your favorite zoo animal?", path: 'animals > wild animals' },
    { question: "What's your favorite fruit?", path: 'food > fruit' },
    { question: "What's your favorite vegetable?", path: 'food > vegetables' },
    { question: "What's your favorite soup?", path: 'food > soup' },
    { question: "What's your favorite accessory?", path: 'clothing > clothing accessories' },
    { question: "What's your favorite shape?", path: 'describe > shapes' },
    { question: "What's your favorite class?", path: 'school > class room' },
  ];

  it.each(expectedHits)('"$question" triggers the $path folder', ({ question, path }) => {
    expect(foldersFor(question)).toContain(path);
  });

  // British spellings / alternate phrasings for a few of the same folders, since the corpus and
  // Cboard data both carry UK spellings (colour, favourite) alongside US ones.
  const spellingVariants: { question: string; path: string }[] = [
    { question: "What's your favourite colour?", path: 'describe > colours' },
    { question: "What's your favourite sport?", path: 'sports' },
    { question: "What's your favourite snack?", path: 'snacks' },
  ];

  it.each(spellingVariants)('"$question" triggers the $path folder', ({ question, path }) => {
    expect(foldersFor(question)).toContain(path);
  });

  // Broader smoke-test batch of common kid/parent conversational questions that should NOT
  // trigger any folder — guards against the new triggers being too broad (false positives).
  // Note: "What do you want to do?" is deliberately NOT here — it's now an expected `activities`
  // hit above, since that folder's whole purpose is answering exactly that open question.
  const noFolderExpected: string[] = [
    'How was school today?',
    'Are you happy?',
    'Do you want to play?',
    'What happened at recess?',
    'Are you feeling okay?',
    'Did you have fun?',
    'What are you thinking about?',
    'Do you need help?',
    'Is everything alright?',
  ];

  it.each(noFolderExpected)('"%s" triggers no folder', (question) => {
    expect(foldersFor(question)).toEqual([]);
  });
});
