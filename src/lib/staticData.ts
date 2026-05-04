import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { CardCategory, ParentGuideElement, ParentType, TopicCategory } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');

interface DefaultCard {
  id: string;
  label: string | { mother: string; father: string };
  label_localized?: string | { mother: string; father: string };
  category: CardCategory;
  image?: any;
}

let _emotion: DefaultCard[] | null = null;
let _core: DefaultCard[] | null = null;
let _initialGuides: any | null = null;

export function loadEmotionCards(): DefaultCard[] {
  if (!_emotion) {
    const yml = fs.readFileSync(path.join(DATA_DIR, 'default_emotion_cards.yml'), 'utf-8');
    _emotion = YAML.parse(yml);
  }
  return _emotion!;
}

export function loadCoreCards(): DefaultCard[] {
  if (!_core) {
    const yml = fs.readFileSync(path.join(DATA_DIR, 'default_core_cards.yml'), 'utf-8');
    _core = YAML.parse(yml);
  }
  return _core!;
}

export function loadInitialGuidesYaml(): any {
  if (!_initialGuides) {
    const yml = fs.readFileSync(path.join(DATA_DIR, 'initial_parent_guides.yml'), 'utf-8');
    _initialGuides = YAML.parse(yml);
  }
  return _initialGuides!;
}

export const EMOTION_LABELS = [
  'joyful', 'glad', 'happy', 'excited', 'sad', 'angry',
  'surprised', 'bored', 'tired', 'afraid', 'worried', 'tough',
];

export function labelForParent(card: DefaultCard, parentType: ParentType): string {
  if (typeof card.label === 'string') return card.label;
  return card.label[parentType] || card.label.mother;
}

export const TOPIC_DESCRIPTION: Record<TopicCategory, string> = {
  plan:   "The dyad shares today's todos or plans.",
  recall: "The dyad gets to know what the child did on that day.",
  free:   'The dyad converses about a free topic that the child is interested in.',
};

/** Return the static initial parent guides for turn 1. Substitutes {child_name}. */
export function buildInitialGuides(
  topic: TopicCategory,
  childName: string,
  parentType: ParentType,
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
