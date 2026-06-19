export interface Dyad {
  id: string;
  alias: string;
  child_name: string;
  child_gender: 'boy' | 'girl';
  parent_type: 'mother' | 'father';
  locale: 'en' | 'kr';
  created_at: string;
  login_code?: string;
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

export interface UserEventStat {
  dyad_id: string;
  alias: string;
  child_name: string;
  screen: string;
  element: string;
  event_count: number;
  last_seen: string;
}
