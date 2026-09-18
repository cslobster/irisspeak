import type { ParentGuideElement, TopicCategory } from './types';

/** The static turn-1 parent guides per topic. Readable copy: TODO/TODO1.md. */
const INITIAL_GUIDES: Record<string, { key: string; guide_category: string; guide: string; example: string }[]> = {
  "plan": [
    {
      "key": "plan-inform",
      "guide_category": "specification",
      "guide": "Explain the main event of the day.",
      "example": "Today we are visiting grandmother."
    },
    {
      "key": "plan-todo",
      "guide_category": "specification",
      "guide": "Explain to-do of your child.",
      "example": "Do you know what to do today, {child_name}?"
    },
    {
      "key": "plan-expectation",
      "guide_category": "intention",
      "guide": "Ask your child what they expect to do.",
      "example": "What do you want to do today, {child_name}?"
    }
  ],
  "recall": [
    {
      "key": "recall-event",
      "guide_category": "specification",
      "guide": "Ask about an event of the day.",
      "example": "What did you do, {child_name}?"
    },
    {
      "key": "recall-memorable",
      "guide_category": "specification",
      "guide": "Ask about the most memorable thing of the day.",
      "example": "What was the most memorable thing, {child_name}?"
    },
    {
      "key": "recall-place",
      "guide_category": "specification",
      "guide": "Ask where {child_name} went to.",
      "example": "Did you go to any interesting place, {child_name}?"
    }
  ],
  "free": [
    {
      "key": "free-inform",
      "guide_category": "specification",
      "guide": "Raise what you are going to talk about.",
      "example": "What do you want to talk about? {subtopic}?"
    },
    {
      "key": "free-curiosity",
      "guide_category": "encourage",
      "guide": "Spice up the conversation.",
      "example": "Why don't we talk about something interesting?"
    },
    {
      "key": "free-specific",
      "guide_category": "extend",
      "guide": "Ask what specific things {child_name} wants to talk about {subtopic}.",
      "example": "What do you want to specifically talk about {subtopic}?"
    }
  ]
};

export function loadInitialGuidesYaml(): any {
  return INITIAL_GUIDES;
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
