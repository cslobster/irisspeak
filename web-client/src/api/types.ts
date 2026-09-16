// Mirrors libs/ts-core/src/lib/model-types.ts (subset).

export type TopicCategory = 'plan' | 'recall' | 'free';
export type ChildGender = 'boy' | 'girl';
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
  personal?: boolean;   // one of the child's own cards in the quick row (history / profile), not a fixed button
  // Corpus enrichment — populated by backend's CorpusRetriever
  corpus_name?: string | null;
  corpus_category?: string | null;
  corpus_cosine?: number | null;
  corpus_mode?: 'exact' | 'word' | 'cos' | null;
  corpus_image_url?: string | null;
  // Only set for a Custom Vocabulary Word using the emoji fallback (no corpus image, no parent
  // upload) — CardChip renders this as text instead of <img>.
  emoji?: string | null;
  // Set when this card represents a folder of choices (e.g. "Numbers") rather
  // than a single word; tapping it should open a picker scoped to folder_path.
  is_folder?: boolean;
  folder_path?: string;
}

export interface CustomVocabularyWord {
  id: string;
  word: string;
  category: 'topic' | 'action';
  is_preference_pointer: boolean;
  image_data?: string | null;
  emoji?: string | null;
  source: 'parent' | 'ai_detected';
  created_at?: string;
}

export interface DyadProfile {
  age?: number | null;
  notes?: string | null;
  communication_style?: string | null;
}

export interface SignupPayload {
  child_name: string;
  child_gender: 'boy' | 'girl';
  login_code: string;
  locale?: string;
  age?: number;
  notes?: string;
  parent_email?: string;
  interests?: string[];
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
  rating?: number | null;
  title?: string | null;
}
