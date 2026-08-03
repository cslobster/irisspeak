import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch as useReduxDispatch, useSelector as useReduxSelector } from 'react-redux';
import type { FreeTopicDetail } from '../api/types';

const FREE_TOPICS_KEY = 'irisspeak:freeTopics';

function loadCachedFreeTopics(): FreeTopicDetail[] {
  try {
    const raw = localStorage.getItem(FREE_TOPICS_KEY);
    return raw ? (JSON.parse(raw) as FreeTopicDetail[]) : [];
  } catch {
    return [];
  }
}

interface AuthState {
  jwt: string | null;
  freeTopics: FreeTopicDetail[];
  childName: string | null;
  isAuthorizing: boolean;
  error: string | null;
}

const initialAuth: AuthState = {
  jwt: localStorage.getItem('irisspeak:jwt'),
  freeTopics: loadCachedFreeTopics(),
  childName: localStorage.getItem('irisspeak:childName'),
  isAuthorizing: false,
  error: null,
};

const auth = createSlice({
  name: 'auth',
  initialState: initialAuth,
  reducers: {
    authStart(state) { state.isAuthorizing = true; state.error = null; },
    authSuccess(state, a: PayloadAction<{ jwt: string; freeTopics: FreeTopicDetail[]; childName?: string }>) {
      state.jwt = a.payload.jwt;
      state.freeTopics = a.payload.freeTopics;
      try { localStorage.setItem(FREE_TOPICS_KEY, JSON.stringify(a.payload.freeTopics)); } catch {}
      if (a.payload.childName) {
        state.childName = a.payload.childName;
        localStorage.setItem('irisspeak:childName', a.payload.childName);
      }
      state.isAuthorizing = false;
    },
    setFreeTopics(state, a: PayloadAction<FreeTopicDetail[]>) {
      state.freeTopics = a.payload;
      try { localStorage.setItem(FREE_TOPICS_KEY, JSON.stringify(a.payload)); } catch {}
    },
    authError(state, a: PayloadAction<string>) { state.isAuthorizing = false; state.error = a.payload; },
    logout(state) {
      state.jwt = null;
      state.freeTopics = [];
      state.childName = null;
      localStorage.removeItem('irisspeak:jwt');
      localStorage.removeItem('irisspeak:childName');
      localStorage.removeItem(FREE_TOPICS_KEY);
    },
  },
});

export const { authStart, authSuccess, authError, logout, setFreeTopics } = auth.actions;

export const store = configureStore({
  reducer: { auth: auth.reducer },
});

export type AppState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useDispatch: () => AppDispatch = useReduxDispatch;
export const useSelector: TypedUseSelectorHook<AppState> = useReduxSelector;
