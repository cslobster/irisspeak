import axios, { AxiosInstance } from 'axios';
import type {
  AuthResponse, SessionTopicInfo, SessionStartResult,
  ChildCardRecommendationResult, ResponseWithTurnId,
  ParentGuideRecommendationResult, CardSelectionResult,
  ParentExampleMessage, CardInfo, DialogueMessage,
} from './types';

declare const __BACKEND_URL__: string;
// Empty string → relative URL, so Vite's proxy forwards /api/* to localhost:3000.
// This is the default for both local and LAN (iPad) access over HTTPS.
// Set VITE_BACKEND_ADDRESS to override for production deploys.
const _backendBase = (typeof __BACKEND_URL__ !== 'undefined' ? __BACKEND_URL__ : '') || '';
const BASE_URL = _backendBase + '/api/v1';
const JWT_KEY = 'aacesstalk:jwt';

class ApiClient {
  private http: AxiosInstance;
  private _jwt: string | null = null;

  constructor() {
    // Without this, axios defaults to no timeout at all — a slow/stuck LLM call or a Neon
    // reconnect hiccup would leave "Regenerating…"-style busy spinners spinning forever with no
    // way to recover, since the request that's supposed to clear them never resolves or rejects.
    // 20s comfortably covers a cold LLM call (~7s measured) plus DB round trips with headroom.
    this.http = axios.create({ baseURL: BASE_URL, timeout: 20000 });
    this._jwt = localStorage.getItem(JWT_KEY);
    this.http.interceptors.request.use((cfg) => {
      if (this._jwt) cfg.headers.Authorization = `Bearer ${this._jwt}`;
      return cfg;
    });
    this.http.interceptors.response.use(
      (r) => r,
      (err) => {
        const status = err?.response?.status;
        if (status === 401 && this._jwt) {
          this.setJwt(null);
          if (typeof window !== 'undefined' && window.location.pathname !== '/') {
            window.location.replace('/?expired=1');
          }
        }
        return Promise.reject(err);
      }
    );
  }

  get jwt() { return this._jwt; }
  setJwt(jwt: string | null) {
    this._jwt = jwt;
    if (jwt) localStorage.setItem(JWT_KEY, jwt);
    else localStorage.removeItem(JWT_KEY);
  }

  async ping(): Promise<boolean> {
    try { await this.http.head('/ping'); return true; } catch { return false; }
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    const r = await this.http.post<AuthResponse>('/dyad/account/login', { username, password });
    this.setJwt(r.data.jwt);
    return r.data;
  }

  async newSession(topic: SessionTopicInfo, timezone: string): Promise<string> {
    const r = await this.http.post<string>('/dyad/session/new', { topic, timezone });
    return r.data;
  }

  async startSession(sessionId: string): Promise<SessionStartResult> {
    const r = await this.http.post<SessionStartResult>(`/dyad/session/${sessionId}/start`);
    return r.data;
  }

  async endSession(sessionId: string): Promise<void> {
    await this.http.put(`/dyad/session/${sessionId}/end`);
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.http.delete(`/dyad/session/${sessionId}/abort`);
  }

  async sendParentText(sessionId: string, message: string): Promise<ResponseWithTurnId<ChildCardRecommendationResult>> {
    const r = await this.http.post<ResponseWithTurnId<ChildCardRecommendationResult>>(
      `/dyad/session/${sessionId}/message/parent/message/text`, { message }
    );
    return r.data;
  }

  async sendParentAudio(sessionId: string, turnId: string, blob: Blob): Promise<ResponseWithTurnId<ChildCardRecommendationResult>> {
    const fd = new FormData();
    fd.append('turn_id', turnId);
    fd.append('file', blob, `parent_${Date.now()}.webm`);
    const r = await this.http.post<ResponseWithTurnId<ChildCardRecommendationResult>>(
      `/dyad/session/${sessionId}/message/parent/message/audio?session_id=${encodeURIComponent(sessionId)}`,
      fd, { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return r.data;
  }

  async parentExample(sessionId: string, recommendationId: string, guideId: string): Promise<ParentExampleMessage> {
    const r = await this.http.post<ParentExampleMessage>(
      `/dyad/session/${sessionId}/message/parent/example`,
      { recommendation_id: recommendationId, guide_id: guideId }
    );
    return r.data;
  }

  async addChildCard(sessionId: string, card: CardInfo): Promise<CardSelectionResult> {
    const r = await this.http.post<CardSelectionResult>(
      `/dyad/session/${sessionId}/message/child/add_card`,
      { id: card.id, recommendation_id: card.recommendation_id }
    );
    return r.data;
  }

  async refreshCards(sessionId: string): Promise<ChildCardRecommendationResult> {
    const r = await this.http.put<ChildCardRecommendationResult>(`/dyad/session/${sessionId}/message/child/refresh_cards`);
    return r.data;
  }

  async removeCard(sessionId: string, index: number): Promise<CardSelectionResult> {
    const r = await this.http.put<CardSelectionResult>(
      `/dyad/session/${sessionId}/message/child/pop_last_card`,
      { index }
    );
    return r.data;
  }

  async addFreeCard(sessionId: string, label: string, category: string, image_url: string | null): Promise<CardSelectionResult> {
    const r = await this.http.post<CardSelectionResult>(
      `/dyad/session/${sessionId}/message/child/add_free_card`,
      { label, category, image_url },
    );
    return r.data;
  }

  async inferSentence(sessionId: string): Promise<{ sentence: string }> {
    const r = await this.http.post<{ sentence: string }>(
      `/dyad/session/${sessionId}/message/child/infer_sentence`
    );
    return r.data;
  }

  // Banks the just-approved sentence and returns a fresh card set so the child can
  // keep building more sentences in the same turn (see finishChildTurn to end it).
  async confirmCards(sessionId: string): Promise<ResponseWithTurnId<ChildCardRecommendationResult>> {
    const r = await this.http.post<ResponseWithTurnId<ChildCardRecommendationResult>>(
      `/dyad/session/${sessionId}/message/child/confirm_cards`
    );
    return r.data;
  }

  async finishChildTurn(sessionId: string): Promise<ResponseWithTurnId<ParentGuideRecommendationResult>> {
    const r = await this.http.post<ResponseWithTurnId<ParentGuideRecommendationResult>>(
      `/dyad/session/${sessionId}/message/child/finish_turn`
    );
    return r.data;
  }

  async getDialogue(sessionId: string): Promise<{ dyad_id: string; dialogue: DialogueMessage[] }> {
    const r = await this.http.get(`/dyad/session/${sessionId}/message/all`);
    return r.data;
  }

  async listSessions(): Promise<{ dyad_id: string; sessions: import('./types').ExtendedSessionInfo[] }> {
    const r = await this.http.get('/dyad/session/list');
    return r.data;
  }

  async getSessionInfo(sessionId: string): Promise<import('./types').ExtendedSessionInfo> {
    const r = await this.http.get(`/dyad/session/${encodeURIComponent(sessionId)}/info`);
    return r.data;
  }

  async rateSession(sessionId: string, rating: number): Promise<void> {
    await this.http.put(`/dyad/session/${sessionId}/rating`, { rating });
  }

  async getFreeTopics(): Promise<import('./types').FreeTopicDetail[]> {
    const r = await this.http.get<{ dyad_id: string; details: import('./types').FreeTopicDetail[] }>(
      '/dyad/data/freetopics'
    );
    return r.data.details;
  }

  // ---- Personalization core: Custom Vocabulary Word + Profile Fact (see CONTEXT.md) ----

  async listVocabulary(): Promise<import('./types').CustomVocabularyWord[]> {
    const r = await this.http.get<import('./types').CustomVocabularyWord[]>('/dyad/vocabulary');
    return r.data;
  }

  async addVocabularyWord(word: {
    word: string; category: 'topic' | 'action'; is_preference_pointer?: boolean;
    image_data?: string | null; emoji?: string | null;
  }): Promise<import('./types').CustomVocabularyWord> {
    const r = await this.http.post<import('./types').CustomVocabularyWord>('/dyad/vocabulary', word);
    return r.data;
  }

  async deleteVocabularyWord(id: string): Promise<void> {
    await this.http.delete(`/dyad/vocabulary/${id}`);
  }

  async getProfile(): Promise<import('./types').DyadProfile> {
    const r = await this.http.get<import('./types').DyadProfile>('/dyad/profile');
    return r.data;
  }

  async updateProfile(profile: import('./types').DyadProfile): Promise<import('./types').DyadProfile> {
    const r = await this.http.patch<import('./types').DyadProfile>('/dyad/profile', profile);
    return r.data;
  }

  async signup(payload: import('./types').SignupPayload): Promise<{ id: string; alias: string; status: string }> {
    const r = await this.http.post('/dyad/account/signup', payload);
    return r.data;
  }
}

export const api = new ApiClient();
