export interface Dyad {
  id: string;
  alias: string;
  child_name: string;
  child_gender: 'boy' | 'girl';
  parent_type: 'mother' | 'father';
  locale: 'en' | 'kr';
  created_at: string;
  login_code?: string;
  // Personalization core: 'pending' means a self-serve wizard signup awaiting approval (see
  // CONTEXT.md's signup wizard design) — admin-created dyads default to 'active'.
  status?: 'pending' | 'active';
  age?: number | null;
  communication_style?: string | null;
  notes?: string | null;
  parent_email?: string | null;
}

export interface DyadStats {
  id: string;
  alias: string;
  child_name: string;
  child_gender: string;
  parent_type: string;
  locale: string;
  created_at: string;
  session_count: number;
  total_turns: number;
  total_messages: number;
  last_active: string | null;
}

export interface CustomVocabularyWord {
  id: string;
  word: string;
  category: 'topic' | 'action';
  is_preference_pointer: boolean;
  image_data: string | null;
  emoji: string | null;
  source: 'parent' | 'ai_detected';
  created_at: string;
}

export interface UserEventStat {
  dyad_id: string;
  alias: string;
  child_name: string;
  screen: string;
  element: string;
  event_count: number;
  last_seen: string;
}
