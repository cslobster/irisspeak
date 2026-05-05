import axios, { AxiosInstance } from 'axios';
import type {
  AuthResponse, SessionTopicInfo, SessionStartResult,
  ChildCardRecommendationResult, ResponseWithTurnId,
  ParentGuideRecommendationResult, CardSelectionResult,
  ParentExampleMessage, CardInfo, DialogueMessage,
} from './types';

declare const __BACKEND_URL__: string;
const BASE_URL = (typeof __BACKEND_URL__ !== 'undefined' ? __BACKEND_URL__ : 'http://localhost:3000') + '/api/v1';
const JWT_KEY = 'aacesstalk:jwt';

class ApiClient {
  private http: AxiosInstance;
  private _jwt: string | null = null;

  constructor() {
    this.http = axios.create({ baseURL: BASE_URL });
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

  async login(code: string): Promise<AuthResponse> {
    const r = await this.http.post<AuthResponse>('/dyad/account/login', { code });
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

  async popLastCard(sessionId: string): Promise<CardSelectionResult> {
    const r = await this.http.put<CardSelectionResult>(`/dyad/session/${sessionId}/message/child/pop_last_card`);
    return r.data;
  }

  async confirmCards(sessionId: string): Promise<ResponseWithTurnId<ParentGuideRecommendationResult>> {
    const r = await this.http.post<ResponseWithTurnId<ParentGuideRecommendationResult>>(
      `/dyad/session/${sessionId}/message/child/confirm_cards`
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

  async getFreeTopics(): Promise<import('./types').FreeTopicDetail[]> {
    const r = await this.http.get<{ dyad_id: string; details: import('./types').FreeTopicDetail[] }>(
      '/dyad/data/freetopics'
    );
    return r.data.details;
  }
}

export const api = new ApiClient();
