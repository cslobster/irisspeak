import { api } from './client';

interface EventPayload {
  screen: string;
  element: string;
  event_type?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

function track(payload: EventPayload) {
  if (!api.jwt) return;
  const body = { ...payload, ts: Date.now() };
  fetch('/api/v1/dyad/event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api.jwt}`,
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export const analytics = {
  // sign-in
  signInAttempt: () => track({ screen: 'sign_in', element: 'login_button', event_type: 'submit' }),
  signInSuccess: () => track({ screen: 'sign_in', element: 'login_button', event_type: 'success' }),

  // home
  topicSelect: (category: string) =>
    track({ screen: 'home', element: `topic_${category}`, event_type: 'tap' }),
  starsButton: () => track({ screen: 'home', element: 'stars_button', event_type: 'tap' }),
  signOut: () => track({ screen: 'home', element: 'sign_out', event_type: 'tap' }),

  // free-topic screen
  freeTopicSelect: (subtopic: string) =>
    track({ screen: 'free_topic', element: 'topic_select', event_type: 'tap', metadata: { subtopic } }),
  freeTopicAdd: () => track({ screen: 'free_topic', element: 'add_topic', event_type: 'tap' }),

  // session
  parentMessageSend: (sid: string) =>
    track({ screen: 'session', element: 'parent_message_send', event_type: 'submit', session_id: sid }),
  cardTap: (sid: string, label: string) =>
    track({ screen: 'session', element: 'card_tap', event_type: 'tap', session_id: sid, metadata: { label } }),
  cardConfirm: (sid: string) =>
    track({ screen: 'session', element: 'card_confirm', event_type: 'tap', session_id: sid }),
  cardUndo: (sid: string) =>
    track({ screen: 'session', element: 'card_undo', event_type: 'tap', session_id: sid }),
  cardRefresh: (sid: string) =>
    track({ screen: 'session', element: 'card_refresh', event_type: 'tap', session_id: sid }),
  cardSearchOpen: (sid: string) =>
    track({ screen: 'session', element: 'card_search_open', event_type: 'tap', session_id: sid }),
  micStart: (sid: string) =>
    track({ screen: 'session', element: 'mic_start', event_type: 'tap', session_id: sid }),
  micStop: (sid: string) =>
    track({ screen: 'session', element: 'mic_stop', event_type: 'tap', session_id: sid }),
  guideExampleExpand: (sid: string) =>
    track({ screen: 'session', element: 'guide_example', event_type: 'tap', session_id: sid }),
  sessionEnd: (sid: string) =>
    track({ screen: 'session', element: 'session_end', event_type: 'tap', session_id: sid }),
  sessionAbort: (sid: string) =>
    track({ screen: 'session', element: 'session_abort', event_type: 'tap', session_id: sid }),
  dialogueToggle: (sid: string) =>
    track({ screen: 'session', element: 'dialogue_toggle', event_type: 'tap', session_id: sid }),

  // session-end
  sessionEndGoHome: () => track({ screen: 'session_end', element: 'go_home', event_type: 'tap' }),
  sessionEndViewStars: () => track({ screen: 'session_end', element: 'view_stars', event_type: 'tap' }),

  // stars
  starsSessionExpand: () => track({ screen: 'stars', element: 'session_expand', event_type: 'tap' }),
};
