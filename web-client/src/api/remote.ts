// The shared irisspeak.com backend (Neon Postgres behind the Next.js API on Vercel). Signing in here gives the
// same account, profile, custom words, sessions and transcripts as the web client and the admin site.
// Card prediction stays on the device; the server only stores what happened (see device/turn on the API).
// Guests never touch the network: every call below is a no-op without a token.
import { store, setProfile, getProfile, setCustomWords, type HistoryTurn, type ChildProfile } from '../engine/store';

export const API_BASE = 'https://aac-roan.vercel.app/api/v1';
export const CLIENT_ID = 'web-ondevice';   // which app wrote a session; shown in the admin site
const TOKEN_KEY = 'jwt';
const ACCOUNT_KEY = 'account';

export interface Account { alias: string; child_name: string; dyad_id?: string }
export interface RemoteProfile { age: number | null; notes: string | null; communication_style: string | null; setting: string | null; child_name: string; child_gender: string; alias: string }
export interface CustomWord { id: string; word: string; category: 'topic' | 'action'; is_preference_pointer: boolean; image_data: string | null; emoji: string | null; source: string }

export function getToken(): string | null { return store.get<string | null>(TOKEN_KEY, null); }
export function getAccount(): Account | null { return store.get<Account | null>(ACCOUNT_KEY, null); }
export function isSignedIn() { return !!getToken(); }
export const onAuthChange: Set<() => void> = new Set();
function notify() { for (const f of onAuthChange) f(); }

async function call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) { const t = getToken(); if (!t) throw new Error('not signed in'); headers.authorization = `Bearer ${t}`; }
  const r = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && auth) { signOut(); location.hash = '#/?expired=1'; throw new Error('Session expired, please sign in again'); }
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error((data && data.detail) || `HTTP ${r.status}`);
  return data as T;
}

/** Sign in with the irisspeak.com username and login code; pulls the profile and recent history down. */
export async function signIn(username: string, code: string): Promise<Account> {
  const res = await call<{ jwt: string; child_name?: string; alias?: string }>('POST', '/dyad/account/login', { username: username.trim(), password: code.trim() }, false);
  store.set(TOKEN_KEY, res.jwt);
  const acc: Account = { alias: res.alias || username.trim(), child_name: res.child_name || '' };
  store.set(ACCOUNT_KEY, acc);
  await pullProfile().catch(() => {});
  await pullHistory().catch(() => {});
  await syncCustomWords().catch(() => {});
  notify();
  return acc;
}
/** Ask the API to email a six-digit sign-in code to the parent's address. Answers the same way whether or not
 *  the address is on an account; `sent: false` with reason 'not_configured' means email is not set up yet. */
export async function requestEmailCode(email: string): Promise<{ sent: boolean; reason?: string }> {
  return call<{ sent: boolean; reason?: string }>('POST', '/dyad/account/email/request', { email: email.trim() }, false);
}
/** Finish an email-code sign-in and pull the account down, exactly as a password sign-in does. */
export async function signInWithEmailCode(email: string, code: string): Promise<Account> {
  const res = await call<{ jwt: string; child_name?: string; alias?: string }>('POST', '/dyad/account/email/verify', { email: email.trim(), code: code.trim() }, false);
  store.set(TOKEN_KEY, res.jwt);
  const acc: Account = { alias: res.alias || '', child_name: res.child_name || '' };
  store.set(ACCOUNT_KEY, acc);
  await pullProfile().catch(() => {});
  await pullHistory().catch(() => {});
  await syncCustomWords().catch(() => {});
  notify();
  return acc;
}

/** Where "Sign in with Google" starts: the API sends the browser to Google and back to #/google with a JWT. */
export function googleSignInUrl(): string {
  const back = `${location.origin}${location.pathname}#/google`;
  return `${API_BASE}/dyad/account/google/start?redirect=${encodeURIComponent(back)}`;
}
/** Finish a Google sign-in: the API already made (or found) the account and issued a normal dyad JWT. */
export async function completeGoogleSignIn(jwt: string, alias?: string, childName?: string): Promise<Account> {
  store.set(TOKEN_KEY, jwt);
  const acc: Account = { alias: alias || '', child_name: childName || '' };
  store.set(ACCOUNT_KEY, acc);
  await pullProfile().then(p => { acc.alias = p.alias || acc.alias; acc.child_name = p.child_name || acc.child_name; store.set(ACCOUNT_KEY, acc); }).catch(() => {});
  await pullHistory().catch(() => {});
  await syncCustomWords().catch(() => {});
  notify();
  return acc;
}
export function signOut() { store.set(TOKEN_KEY, null); store.set(ACCOUNT_KEY, null); notify(); }
/** First-run setup (boy/girl, age, notes) is asked until the account has an age, or it was done on this device. */
export function needsSetup(): boolean { return isSignedIn() && getProfile().age == null && !store.get<boolean>('setup_done', false); }
export function markSetupDone() { store.set('setup_done', true); }

export async function signUp(p: { child_name: string; child_gender: 'boy' | 'girl'; login_code: string; age?: number; notes?: string; parent_email?: string; interests?: string[] }) {
  return call<{ id: string; alias: string; status: string }>('POST', '/dyad/account/signup', { ...p, locale: 'en' }, false);
}

/** Server profile -> local profile (name, setting, age, notes, style). */
export async function pullProfile(): Promise<RemoteProfile> {
  const p = await call<RemoteProfile>('GET', '/dyad/profile');
  const local = getProfile();
  setProfile({ ...local, name: p.child_name || local.name, gender: p.child_gender === 'boy' ? 'boy' : p.child_gender === 'girl' ? 'girl' : local.gender, setting: p.setting || local.setting, age: p.age ?? local.age, notes: p.notes ?? local.notes, communication_style: p.communication_style ?? local.communication_style });
  const acc = getAccount(); if (acc) store.set(ACCOUNT_KEY, { ...acc, child_name: p.child_name || acc.child_name, alias: p.alias || acc.alias });
  return p;
}
/** Local profile -> server (called after the settings screen saves). */
export async function pushProfile(p: ChildProfile): Promise<void> {
  if (!isSignedIn()) return;
  await call('PATCH', '/dyad/profile', { age: p.age ?? null, notes: p.notes ?? null, communication_style: p.communication_style ?? null, setting: p.setting, child_name: p.name || null, child_gender: p.gender ?? null });
}

/** The child's last confirmed turns from every device, into the local history the reranker reads. */
export async function pullHistory(): Promise<number> {
  const r = await call<{ turns: (HistoryTurn & { session_id: string })[] }>('GET', '/dyad/history?limit=50');
  const turns = [...r.turns].reverse().map(t => ({ partner: t.partner, answer: t.answer, cards: t.cards, labels: t.labels, t: t.t }));
  store.set('history', turns);
  return turns.length;
}

export async function listCustomWords(): Promise<CustomWord[]> { return isSignedIn() ? call<CustomWord[]>('GET', '/dyad/vocabulary') : []; }
export async function addVocabularyWord(w: { word: string; category: 'topic' | 'action'; is_preference_pointer?: boolean; image_data?: string | null; emoji?: string | null }): Promise<CustomWord> {
  return call<CustomWord>('POST', '/dyad/vocabulary', w);
}
export async function deleteVocabularyWord(id: string): Promise<void> { await call('DELETE', `/dyad/vocabulary/${encodeURIComponent(id)}`); }
/** Server custom words -> local searchable cards (a base64 image becomes a data URL). */
export async function syncCustomWords(): Promise<number> {
  const words = await listCustomWords();
  setCustomWords(words.map(w => ({
    word: w.word, category: w.category === 'action' ? 'action' : 'topic',
    image_url: w.image_data ? (w.image_data.startsWith('data:') ? w.image_data : `data:image/png;base64,${w.image_data}`) : null,
    emoji: w.emoji || null, favourite: !!w.is_preference_pointer,
  })));
  return words.length;
}

// ---- previous conversations from every device (irisspeak.com, other iPads): the shared account's session list and transcripts
export async function remoteListSessions(): Promise<{ sessions: any[] } | null> {
  if (!isSignedIn()) return null;
  try { return await call<{ dyad_id: string; sessions: any[] }>('GET', '/dyad/session/list'); } catch { return null; }
}
export async function remoteDialogue(sessionId: string): Promise<{ dialogue: any[] } | null> {
  if (!isSignedIn()) return null;
  try { return await call<{ dyad_id: string; dialogue: any[] }>('GET', `/dyad/session/${encodeURIComponent(sessionId)}/message/all`); } catch { return null; }
}

// ---- sessions and turns: fire-and-forget mirrors of what the device did. Failures never block the child.
export async function remoteNewSession(tz: string): Promise<string | null> {
  if (!isSignedIn()) return null;
  try { return await call<string>('POST', '/dyad/session/new', { topic: { category: 'free' }, timezone: tz, client: CLIENT_ID }); } catch { return null; }
}
export async function remoteStart(sessionId: string) {
  if (!isSignedIn()) return;
  try { await call('POST', `/dyad/session/${encodeURIComponent(sessionId)}/start`); } catch {}
}
export async function remoteParentTurn(sessionId: string, text: string) {
  if (!isSignedIn()) return;
  try { await call('POST', `/dyad/session/${encodeURIComponent(sessionId)}/device/turn`, { role: 'parent', text, timestamp: Date.now() }); } catch {}
}
export async function remoteChildTurn(sessionId: string, cards: unknown[], sentence: string, shown: unknown[]) {
  if (!isSignedIn()) return;
  try { await call('POST', `/dyad/session/${encodeURIComponent(sessionId)}/device/turn`, { role: 'child', cards, sentence, shown, timestamp: Date.now() }); } catch {}
}
export async function remoteEnd(sessionId: string) {
  if (!isSignedIn()) return;
  try { await call('PUT', `/dyad/session/${encodeURIComponent(sessionId)}/end`); } catch {}
}
export async function remoteRate(sessionId: string, rating: number) {
  if (!isSignedIn()) return;
  try { await call('PUT', `/dyad/session/${encodeURIComponent(sessionId)}/rating`, { rating }); } catch {}
}
export async function remoteEvent(screen: string, element: string, session_id?: string, metadata?: unknown) {
  if (!isSignedIn()) return;
  try { await call('POST', '/dyad/event', { screen, element, event_type: 'tap', session_id, metadata, ts: Date.now() }); } catch {}
}
