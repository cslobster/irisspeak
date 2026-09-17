import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { ParentGuideElement, TopicCategory } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');

let _initialGuides: any | null = null;

export function loadInitialGuidesYaml(): any {
  if (!_initialGuides) {
    const yml = fs.readFileSync(path.join(DATA_DIR, 'initial_parent_guides.yml'), 'utf-8');
    _initialGuides = YAML.parse(yml);
  }
  return _initialGuides!;
}

/** Return the static initial parent guides for turn 1. Substitutes {child_name}. */
export function buildInitialGuides(
  topic: TopicCategory,
  childName: string,
): ParentGuideElement[] {
  // YAML root is a map { plan: [...], recall: [...], free: [...] }
  const root = loadInitialGuidesYaml() as unknown as Record<string, any[]>;
  const list = Array.isArray(root?.[topic]) ? root[topic] : [];
  return list.slice(0, 3).map((g: any, i: number) => {
    const guide = String(g.guide || '').replaceAll('{child_name}', childName);
    return {
      id: `static-${topic}-${i}`,
      category: g.guide_category || g.category || 'specification',
      guide,
      type: 'messaging' as const,
      is_generated: false,
      static_guide_key: g.key || null,
    } as ParentGuideElement;
  });
}
