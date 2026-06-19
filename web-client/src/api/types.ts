// Mirrors libs/ts-core/src/lib/model-types.ts (subset).

export type TopicCategory = 'plan' | 'recall' | 'free';
export type DialogueRole = 'parent' | 'child';
export type CardCategory = 'topic' | 'action' | 'emotion' | 'core';
export type ParentGuideType = 'messaging' | 'feedback';
export type ParentGuideCategory =
  | 'intention' | 'specification' | 'choice' | 'clues' | 'coping'
  | 'stimulate' | 'share' | 'empathize' | 'encourage'
  | 'emotion' | 'extend' | 'terminate';

export interface CardInfo {
  id: string;
  recommendation_id: string;
  label: string;
  label_localized: string;
  category: CardCategory;
  // Corpus enrichment — populated by backend's CorpusRetriever
  corpus_name?: string | null;
  corpus_category?: string | null;
  corpus_cosine?: number | null;
  corpus_mode?: 'exact' | 'word' | 'cos' | null;
  corpus_image_url?: string | null;
}

export interface ChildCardRecommendationResult {
  id: string;
  timestamp: number;
  cards: CardInfo[];
}

export interface ParentGuideElement {
  id: string;
  category: ParentGuideCategory | string[];
  guide: string;
  guide_localized?: string | null;
  type: ParentGuideType;
  is_generated?: boolean;
  static_guide_key?: string;
}

export interface ParentGuideRecommendationResult {
  id: string;
  timestamp: number;
  turn_id: string;
  guides: ParentGuideElement[];
}

export interface ParentExampleMessage {
  id: string;
  timestamp: number;
  recommendation_id?: string;
  guide_id?: string;
  message: string;
  message_localized?: string;
}

export interface FreeTopicDetail {
  id: string;
  subtopic: string;
  subtopic_description: string;
}

export interface DialogueMessage {
  role: DialogueRole;
  content: string | CardInfo[];
  content_localized?: string;
  recommendation_id?: string;
  turn_id?: string;
}

export interface SessionTopicInfo {
  category: TopicCategory;
  subtopic?: string;
  subtopic_description?: string;
}

export interface AuthResponse {
  jwt: string;
  free_topics: FreeTopicDetail[];
  child_name?: string;
}

export interface SessionStartResult {
  parent_guides: ParentGuideRecommendationResult;
  turn_id: string;
}

export interface ResponseWithTurnId<T> {
  payload: T;
  next_turn_id: string;
}

export interface CardSelectionResult {
  interim_cards: CardInfo[];
  new_recommendation: ChildCardRecommendationResult;
}

export interface ExtendedSessionInfo {
  id: string;
  dyad_id: string;
  topic: SessionTopicInfo;
  status: 'initial' | 'started' | 'conversation' | 'terminated';
  local_timezone: string;
  started_timestamp: number;
  ended_timestamp: number | null;
  num_turns: number;
}
