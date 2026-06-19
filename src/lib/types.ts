// Mirrors libs/py_core/py_core/system/model.py + the slim types the web client uses.

export type CardCategory = 'topic' | 'action' | 'emotion' | 'core';
export type ParentType = 'mother' | 'father';
export type ChildGender = 'boy' | 'girl';
export type UserLocale = 'en' | 'kr';
export type DialogueRole = 'parent' | 'child';
export type TopicCategory = 'plan' | 'recall' | 'free';
export type SessionStatus = 'initial' | 'started' | 'conversation' | 'terminated';

export interface Dyad {
  id: string;
  alias: string;
  child_name: string;
  child_gender: ChildGender;
  parent_type: ParentType;
  locale: UserLocale;
}

export interface CardInfo {
  id: string;
  recommendation_id: string;
  label: string;
  label_localized: string;
  category: CardCategory;
  // Corpus enrichment — filled in by CorpusRetriever
  corpus_name?: string | null;
  corpus_category?: string | null;
  corpus_cosine?: number | null;
  corpus_mode?: 'exact' | 'word' | 'cos' | null;
  corpus_image_url?: string | null;
}

export interface ChildCardRecommendationResult {
  id: string;
  timestamp: number;
  turn_id: string;
  cards: CardInfo[];
}

export type ParentGuideType = 'messaging' | 'feedback';
export type ParentGuideCategory =
  | 'intention' | 'specification' | 'choice' | 'clues' | 'coping'
  | 'stimulate' | 'share' | 'empathize' | 'encourage'
  | 'emotion' | 'extend' | 'terminate';

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

export interface SessionTopicInfo {
  category: TopicCategory;
  subtopic?: string;
  subtopic_description?: string;
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
  timestamp?: number;
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
  status: SessionStatus;
  local_timezone?: string | null;
  started_timestamp: number;
  ended_timestamp: number | null;
  num_turns: number;
}
