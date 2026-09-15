export interface Dyad {
  id: string;
  alias: string;
  child_name: string;
  child_gender: 'boy' | 'girl';
  locale: 'en' | 'kr';
  created_at: string;
  login_code?: string;
  // Personalization core: 'pending' means a self-serve wizard signup awaiting approval (see
  // CONTEXT.md's signup wizard design) — admin-created dyads default to 'active'.
  status?: 'pending' | 'active';
  // the on-device app (irisspeak.com/.org and the iPad app) fills these in
  google_email?: string | null;
  google_sub?: string | null;
  setting?: string | null;
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

/** A conversation as the admin site sees it. `client` says which app produced it:
 *  'irisspeak.com' / null = the old cloud web client, 'irisspeak.org' = the on-device web app,
 *  'irisspeak.app' = the iPad/iPhone app. */
export interface TranscriptSession {
  id: string;
  topic_category?: string | null;
  subtopic?: string | null;
  status?: string | null;
  num_turns?: number | null;
  rating?: number | null;
  started_timestamp?: number | string | null;
  ended_timestamp?: number | string | null;
  created_at?: string | null;
  client?: string | null;
}
