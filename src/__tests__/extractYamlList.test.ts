import { describe, it, expect } from 'vitest';
import { extractYamlList } from '@/lib/gemini';

describe('extractYamlList', () => {
  it('parses inline bracket format', () => {
    expect(extractYamlList('folder: [numbers]', 'folder')).toEqual(['numbers']);
  });

  it('parses block-list format', () => {
    const text = 'topics:\n  - park\n  - zoo\n';
    expect(extractYamlList(text, 'topics')).toEqual(['park', 'zoo']);
  });

  it('falls back to a bare, bracket-less scalar', () => {
    // Gemini occasionally drops the brackets we ask for despite instructions —
    // this must not silently lose the value.
    expect(extractYamlList('folder: numbers', 'folder')).toEqual(['numbers']);
  });

  it('returns empty when the key is absent', () => {
    expect(extractYamlList('topics: [a, b]', 'folder')).toEqual([]);
  });

  it('finds the requested key amid unrelated prose/reasoning text', () => {
    const text = 'Some reasoning about the theme.\nfolder: numbers\nmore text after';
    expect(extractYamlList(text, 'folder')).toEqual(['numbers']);
  });
});
