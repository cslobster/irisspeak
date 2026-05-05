import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { HillBackground } from '../components/HillBackground';
import { TurnBanner } from '../components/TurnBanner';
import { RecordingPill } from '../components/RecordingPill';
import { CardChip } from '../components/CardChip';
import { CloseIcon, MenuIcon, MicIcon, StopIcon, StarIcon } from '../components/Icons';
import { MicRecorder } from '../audio/recorder';
import { speak, speakCard, stopSpeaking } from '../audio/tts';
import { WebSpeechRecognizer, isWebSpeechSupported } from '../audio/webspeech';
// Whisper module is dynamic-imported only as a fallback when the browser lacks
// Web Speech API (mainly Firefox), so the 23 MB onnx-runtime WASM isn't pulled
// into the initial session bundle on iOS / Chrome / Safari.
import type { ProgressEvent as WhisperProgressEvent } from '../audio/whisper';
type WhisperModule = typeof import('../audio/whisper');
let _whisperMod: Promise<WhisperModule> | null = null;
function loadWhisperModule(): Promise<WhisperModule> {
  if (!_whisperMod) _whisperMod = import('../audio/whisper');
  return _whisperMod;
}
import { emojiForCard } from '../cardEmoji';
import type {
  CardInfo, ChildCardRecommendationResult, ParentGuideRecommendationResult,
  TopicCategory, DialogueRole, DialogueMessage,
} from '../api/types';

interface LocationState {
  topic: { category: TopicCategory; subtopic?: string; subtopic_description?: string };
}

type Phase = 'init' | 'idle' | 'thinking' | 'closing';

export function SessionScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const nav = useNavigate();
  const { state } = useLocation() as { state?: LocationState };
  const topic = state?.topic ?? { category: 'plan' as TopicCategory };

  const [phase, setPhase] = useState<Phase>('init');
  const [phaseLabel, setPhaseLabel] = useState('Starting your session…');
  const [role, setRole] = useState<DialogueRole>('parent');
  const [turnId, setTurnId] = useState<string | null>(null);
  const [parentGuide, setParentGuide] = useState<ParentGuideRecommendationResult | null>(null);
  const [childRec, setChildRec] = useState<ChildCardRecommendationResult | null>(null);
  const [interimCards, setInterimCards] = useState<CardInfo[]>([]);
  const [dialogue, setDialogue] = useState<DialogueMessage[]>([]);
  const [parentMessage, setParentMessage] = useState('');
  const [exampleByGuideId, setExampleByGuideId] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showDialogue, setShowDialogue] = useState(false);
  const [turnNumber, setTurnNumber] = useState(0);
  const [lastParentMessage, setLastParentMessage] = useState<string | null>(null);

  // Recording
  const [recState, setRecState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [recLevel, setRecLevel] = useState(0);
  const recRef = useRef<MicRecorder | null>(null);

  // Input mode: voice (default) or text
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');

  // Voice transcription. Two backends:
  //   1. Web Speech API (preferred — native iOS dictation / Chrome / Edge / Safari)
  //   2. Whisper-tiny.en via @huggingface/transformers (fallback for Firefox)
  const useWebSpeech = useMemo(() => isWebSpeechSupported(), []);
  const webSpeechRef = useRef<WebSpeechRecognizer | null>(null);
  if (useWebSpeech && !webSpeechRef.current) webSpeechRef.current = new WebSpeechRecognizer();
  const [partialTranscript, setPartialTranscript] = useState('');

  const [whisperState, setWhisperState] = useState<'idle' | 'loading' | 'ready' | 'transcribing' | 'error'>('idle');
  const [whisperProgress, setWhisperProgress] = useState(0);
  const [whisperBackend, setWhisperBackend] = useState<'webgpu' | 'wasm'>('wasm');
  const whisperLoadedRef = useRef(false);

  const ensureWhisper = useCallback(async (): Promise<WhisperModule> => {
    const mod = await loadWhisperModule();
    if (whisperLoadedRef.current) return mod;
    setWhisperState('loading');
    setWhisperProgress(0);
    mod.setProgressCallback((p: WhisperProgressEvent) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        setWhisperProgress(prev => Math.max(prev, Math.round(p.progress!)));
      }
    });
    try {
      await mod.preloadWhisper();
      whisperLoadedRef.current = true;
      setWhisperBackend(mod.whisperDevice());
      setWhisperState('ready');
    } catch (e: any) {
      setWhisperState('error');
      setErrorMsg(`Speech model failed to load: ${e?.message || e}`);
    } finally {
      mod.setProgressCallback(null);
    }
    return mod;
  }, []);

  // Backend ping
  const [serverOk, setServerOk] = useState(true);
  useEffect(() => {
    const id = setInterval(async () => setServerOk(await api.ping()), 10000);
    return () => clearInterval(id);
  }, []);

  const startedRef = useRef(false);

  // ----- Lifecycle: start the session -----
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        setPhaseLabel('Starting your session…');
        const r = await api.startSession(sessionId);
        setTurnId(r.turn_id);
        setParentGuide(r.parent_guides);
        setRole('parent');
        setTurnNumber(1);
        setPhase('idle');
      } catch (e: any) {
        // The session was already started in a prior page-load. Recovering an
        // in-flight session needs server state we don't track on the client, so
        // bounce the user home with a hint instead of leaving them on a blank screen.
        const status = e?.response?.status;
        if (status === 500 || status === 400) {
          setErrorMsg('This session was already started in a previous tab. Returning home…');
          setTimeout(() => nav('/home', { replace: true }), 1500);
          return;
        }
        setErrorMsg(e?.response?.data?.detail || e?.message || 'Failed to start session');
      }
    })();
  }, [sessionId, nav]);

  // ----- Auto-record on parent turn -----
  // Web Speech path: just kick off the native recognizer (it captures audio itself).
  // Whisper fallback path: spin up MicRecorder so we can grab the blob to transcribe.
  const webSpeechResultRef = useRef<Promise<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (phase === 'idle' && role === 'parent' && inputMode === 'voice') {
      if (useWebSpeech && webSpeechRef.current) {
        const rec = webSpeechRef.current;
        rec.onState = (s) => {
          if (cancelled) return;
          setRecState(s === 'listening' ? 'recording' : s === 'stopping' ? 'paused' : 'idle');
        };
        rec.onPartial = (text) => { if (!cancelled) setPartialTranscript(text); };
        setPartialTranscript('');
        webSpeechResultRef.current = rec.start({ lang: 'en-US' }).catch((e) => {
          if (!cancelled) {
            setErrorMsg(`Voice not available: ${e?.message || 'permission denied'}`);
            setInputMode('text');
          }
          return '';
        });
      } else {
        const r = new MicRecorder();
        r.onMeter = (rms) => { if (!cancelled) setRecLevel(rms); };
        r.onState = (s) => { if (!cancelled) setRecState(s); };
        recRef.current = r;
        r.start().catch(() => {
          if (!cancelled) setInputMode('text');
        });
      }
    }
    return () => {
      cancelled = true;
      if (useWebSpeech && webSpeechRef.current?.getState() !== 'idle') {
        webSpeechRef.current?.abort();
      }
      const r = recRef.current;
      recRef.current = null;
      if (r && r.getState() !== 'idle') {
        r.stop(true).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, role, inputMode, useWebSpeech]);

  // Reset meter UI in idle state
  useEffect(() => {
    if (recState === 'idle') setRecLevel(0);
  }, [recState]);

  // ----- Refresh dialogue panel -----
  const refreshDialogue = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await api.getDialogue(sessionId);
      setDialogue(r.dialogue);
    } catch {}
  }, [sessionId]);

  // ----- Submit parent (voice or text) -----
  const submitParent = useCallback(async () => {
    if (!sessionId) return;
    try {
      let submittedText: string | null = null;

      if (inputMode === 'voice' && useWebSpeech && webSpeechRef.current?.getState() === 'listening') {
        // Web Speech path: stop the recognizer; the start() Promise resolves with the final transcript.
        webSpeechRef.current.stop();
        setPhase('thinking');
        setPhaseLabel('Finishing transcription…');
        const text = await (webSpeechResultRef.current ?? Promise.resolve(''));
        webSpeechResultRef.current = null;
        setPartialTranscript('');
        if (!text) {
          setErrorMsg('No speech detected. Try again or switch to typing.');
          setPhase('idle');
          return;
        }
        submittedText = text;
      } else if (inputMode === 'voice' && recRef.current && recRef.current.getState() !== 'idle') {
        // Whisper fallback path
        const blob = await recRef.current.stop();
        if (!blob || blob.size < 200) {
          setErrorMsg('No speech detected. Please try again or switch to typing.');
          return;
        }
        const mod = await ensureWhisper();
        setWhisperState('transcribing');
        setPhase('thinking');
        setPhaseLabel('Transcribing your voice…');
        const text = await mod.transcribeBlob(blob);
        setWhisperState('ready');
        if (!text) {
          setErrorMsg('Could not understand the audio. Try speaking more clearly or switch to typing.');
          setPhase('idle');
          return;
        }
        submittedText = text;
      } else if (parentMessage.trim()) {
        submittedText = parentMessage.trim();
      } else {
        return;
      }

      setPhase('thinking');
      setPhaseLabel('Generating cards for the child…');
      const result = await api.sendParentText(sessionId, submittedText);
      setTurnId(result.next_turn_id);
      setRole('child');
      setChildRec(result.payload);
      setInterimCards([]);
      setLastParentMessage(submittedText);
      setParentMessage('');
      setTurnNumber(n => n + 1);
      setPhase('idle');
      refreshDialogue();
    } catch (e: any) {
      setErrorMsg(e?.response?.data?.detail || e?.message || 'Failed to submit');
      setPhase('idle');
      setWhisperState(whisperLoadedRef.current ? 'ready' : 'idle');
    }
  }, [sessionId, parentMessage, inputMode, refreshDialogue, ensureWhisper, useWebSpeech]);

  // ----- Cancel ongoing recording, switch to text -----
  const cancelRecording = useCallback(async () => {
    if (useWebSpeech && webSpeechRef.current?.getState() !== 'idle') {
      webSpeechRef.current?.abort();
      webSpeechResultRef.current = null;
      setPartialTranscript('');
    }
    const r = recRef.current;
    if (r && r.getState() !== 'idle') await r.stop(true);
    setInputMode('text');
  }, [useWebSpeech]);

  const switchToVoice = useCallback(() => {
    if (phase !== 'idle' || role !== 'parent') return;
    setInputMode('voice');
    // For Web Speech we don't need to preload anything (native recognizer);
    // for the Whisper fallback, kick off model download while the user records.
    if (!useWebSpeech) ensureWhisper();
  }, [phase, role, ensureWhisper, useWebSpeech]);

  // ----- Child interactions -----
  // We use OPTIMISTIC updates: update the selection deck instantly so the user sees
  // their tap immediately, while the backend regenerates the next card recommendation
  // (an LLM call) in the background and we render a subtle overlay on the card grid.
  const [refreshingCards, setRefreshingCards] = useState(false);

  // Tap appends to the child's interim selection; the screen does NOT switch turns
  // until they tap the explicit Done ✓ button. (Auto-confirm-on-tap was tried and
  // pulled — on touch screens an instant role flip felt like a crash.)
  const onCardClick = useCallback(async (card: CardInfo) => {
    if (!sessionId || refreshingCards || role !== 'child') return;
    speakCard(card);
    setInterimCards(prev => [...prev, card]); // optimistic
    setRefreshingCards(true);
    try {
      const r = await api.addChildCard(sessionId, card);
      setInterimCards(r.interim_cards);
      setChildRec(r.new_recommendation);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to add card');
      try { const fresh = await api.refreshCards(sessionId); setChildRec(fresh); } catch {}
    } finally {
      setRefreshingCards(false);
    }
  }, [sessionId, role, refreshingCards]);

  const onPopCard = useCallback(async () => {
    if (!sessionId || interimCards.length === 0 || refreshingCards) return;
    setInterimCards(prev => prev.slice(0, -1));
    setRefreshingCards(true);
    try {
      const r = await api.popLastCard(sessionId);
      setInterimCards(r.interim_cards);
      setChildRec(r.new_recommendation);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to pop card');
    } finally {
      setRefreshingCards(false);
    }
  }, [sessionId, interimCards, refreshingCards]);

  const onConfirm = useCallback(async () => {
    if (!sessionId || interimCards.length === 0) return;
    setPhase('thinking');
    setPhaseLabel('Generating parent guides…');
    try {
      const r = await api.confirmCards(sessionId);
      setTurnId(r.next_turn_id);
      setRole('parent');
      setParentGuide(r.payload);
      setInterimCards([]);
      setChildRec(null);
      setTurnNumber(n => n + 1);
      setPhase('idle');
      refreshDialogue();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to confirm');
      setPhase('idle');
    }
  }, [sessionId, interimCards, refreshDialogue]);

  const onRefreshCards = useCallback(async () => {
    if (!sessionId || refreshingCards) return;
    setRefreshingCards(true);
    try {
      const r = await api.refreshCards(sessionId);
      setChildRec(r);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to refresh');
    } finally {
      setRefreshingCards(false);
    }
  }, [sessionId, refreshingCards]);

  // ----- Example utterance -----
  const requestExample = useCallback(async (guideId: string) => {
    if (!sessionId || !parentGuide) return;
    setExampleByGuideId(prev => ({ ...prev, [guideId]: '__loading__' }));
    try {
      const r = await api.parentExample(sessionId, parentGuide.id, guideId);
      setExampleByGuideId(prev => ({ ...prev, [guideId]: r.message }));
      speak(r.message);
    } catch (e: any) {
      setExampleByGuideId(prev => ({ ...prev, [guideId]: '⚠ ' + (e?.message || 'failed') }));
    }
  }, [sessionId, parentGuide]);

  // ----- End / discard -----
  async function endSession() {
    if (!sessionId) { nav('/home', { replace: true }); return; }
    stopSpeaking();
    if (recRef.current) await recRef.current.stop(true).catch(() => {});
    setShowMenu(false);
    setPhase('closing');
    try { await api.endSession(sessionId); } catch {}
    nav(`/session-end/${encodeURIComponent(sessionId)}`, { replace: true });
  }
  async function abortSession() {
    if (!sessionId) { nav('/home', { replace: true }); return; }
    stopSpeaking();
    if (recRef.current) await recRef.current.stop(true).catch(() => {});
    try { await api.abortSession(sessionId); } catch {}
    nav('/home', { replace: true });
  }

  // ----- Keyboard: Enter advances; Esc opens menu -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setShowMenu(true); return; }
      if (phase !== 'idle') return;
      const inTextarea = (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === 'Enter' && (!inTextarea || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (role === 'parent') submitParent();
        else if (role === 'child' && interimCards.length > 0) onConfirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, role, submitParent, onConfirm, interimCards]);

  const stars = useMemo(() => Array.from({ length: Math.floor((turnNumber - 1) / 2) }), [turnNumber]);

  return (
    <HillBackground topic={topic.category} className="pb-24 sm:pb-32">
      <div className="min-h-screen px-3 sm:px-6 py-3 sm:py-6 flex flex-col items-center relative safe-top">
        <RecordingPill state={recState} level={recLevel} />

        {/* Server status & transcript toggle */}
        <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 flex items-center gap-1 sm:gap-2">
          <span className={`text-[9px] sm:text-[10px] font-bold px-2 py-1 rounded-full ${serverOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {serverOk ? 'connected' : 'offline'}
          </span>
          <button
            onClick={() => setShowDialogue(s => !s)}
            className="text-[11px] sm:text-xs font-bold px-2 sm:px-3 py-1 rounded-full bg-white shadow border"
          >
            {showDialogue ? 'Hide' : 'Show'} ({dialogue.length})
          </button>
        </div>

        {/* Turn banner + stars — single horizontal row to save vertical space on iPad landscape */}
        <div className="mt-8 sm:mt-3 flex flex-row items-center justify-center gap-2 sm:gap-3 flex-wrap z-10">
          <TurnBanner role={role} topic={topic.category} subtopic={topic.subtopic} turnNumber={turnNumber} />
          {stars.length > 0 && (
            <div className="flex items-center gap-0.5">
              {stars.slice(0, 6).map((_, i) => <StarIcon key={i} size={20} />)}
              {stars.length > 6 && <span className="text-xs font-bold text-amber-700 ml-1">+{stars.length - 6}</span>}
            </div>
          )}
        </div>

        {/* Center content */}
        <div className="flex-1 self-stretch flex flex-col items-center justify-center my-3 sm:my-8 max-w-5xl w-full mx-auto">
          {(phase === 'init' || phase === 'thinking' || phase === 'closing') && <Loader label={phaseLabel} />}

          {phase === 'idle' && role === 'parent' && parentGuide && (
            <ParentTurn
              guide={parentGuide}
              parentMessage={parentMessage}
              setParentMessage={setParentMessage}
              examples={exampleByGuideId}
              onRequestExample={requestExample}
              onSubmit={submitParent}
              inputMode={inputMode}
              recState={recState}
              onCancelRecording={cancelRecording}
              onSwitchToVoice={switchToVoice}
              whisperState={whisperState}
              whisperProgress={whisperProgress}
              whisperBackend={whisperBackend}
              voiceBackend={useWebSpeech ? 'webspeech' : 'whisper'}
              partialTranscript={partialTranscript}
            />
          )}

          {phase === 'idle' && role === 'child' && childRec && (
            <ChildTurn
              rec={childRec}
              interim={interimCards}
              onCardClick={onCardClick}
              onPop={onPopCard}
              onRefresh={onRefreshCards}
              onConfirm={onConfirm}
              busy={refreshingCards}
              parentMessage={lastParentMessage}
            />
          )}
        </div>

        {/* Menu button */}
        <button
          onClick={() => setShowMenu(true)}
          className="icon-btn fixed left-4 z-20 p-3"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          title="Menu (Esc)"
          aria-label="Open session menu"
        >
          <MenuIcon size={28} />
        </button>

        <div
          className="fixed right-4 z-10 text-[10px] text-slate-500 bg-white/70 px-2 py-1 rounded shadow hidden md:block"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          ↵ to advance · Esc for menu
        </div>

        {showDialogue && (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-white border-t-2 border-slate-200 shadow-2xl rounded-t-3xl p-5 max-h-[60dvh] overflow-auto safe-bottom">
            <div className="flex items-center justify-between mb-3 max-w-3xl mx-auto">
              <h3 className="text-lg font-extrabold">Transcript</h3>
              <button onClick={() => setShowDialogue(false)}><CloseIcon /></button>
            </div>
            {dialogue.length === 0 ? (
              <p className="text-slate-400 italic text-center">Nothing said yet.</p>
            ) : (
              <div className="space-y-2 max-w-3xl mx-auto">
                {dialogue.map((m, i) => (
                  <div key={i} className={`p-3 rounded-xl text-sm ${m.role === 'parent' ? 'bg-blue-50 border-l-4 border-blue-300' : 'bg-purple-50 border-l-4 border-purple-300'}`}>
                    <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">{m.role}</div>
                    {Array.isArray(m.content) ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {m.content.map((c, j) => (
                          <span
                            key={j}
                            className="inline-flex items-center bg-white border border-purple-200 rounded-lg px-2 py-1 text-xs font-bold text-purple-800 shadow-sm"
                            title={c.corpus_name ? `corpus: ${c.corpus_name}` : c.category}
                          >
                            {c.corpus_name || c.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-slate-800">{m.content}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showMenu && (
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowMenu(false)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl p-8 w-80 shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-extrabold">Session menu</h2>
                <button onClick={() => setShowMenu(false)}><CloseIcon /></button>
              </div>
              <button onClick={endSession} className="pill-btn bg-emerald-500 w-full mb-3">End conversation 🌟</button>
              <button onClick={abortSession} className="pill-btn bg-red-400 w-full">Discard (don't save)</button>
              <p className="mt-4 text-xs text-slate-500">End saves stars and transcript. Discard removes everything.</p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-5 py-3 rounded-xl shadow-xl text-sm font-bold flex items-center gap-3 max-w-md">
            {errorMsg}
            <button onClick={() => setErrorMsg(null)}><CloseIcon color="#fff" /></button>
          </div>
        )}
      </div>
    </HillBackground>
  );
}

function Loader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <div className="w-16 h-16 border-4 border-slate-300 border-t-amber-400 rounded-full animate-spin" />
      <p className="text-base font-bold text-slate-600">{label}</p>
    </div>
  );
}

interface ParentTurnProps {
  guide: ParentGuideRecommendationResult;
  parentMessage: string;
  setParentMessage: (s: string) => void;
  examples: Record<string, string>;
  onRequestExample: (id: string) => void;
  onSubmit: () => void;
  inputMode: 'voice' | 'text';
  recState: 'idle' | 'recording' | 'paused';
  onCancelRecording: () => void;
  onSwitchToVoice: () => void;
  whisperState: 'idle' | 'loading' | 'ready' | 'transcribing' | 'error';
  whisperProgress: number;
  whisperBackend: 'webgpu' | 'wasm';
  voiceBackend: 'webspeech' | 'whisper';
  partialTranscript: string;
}

function ParentTurn({
  guide, parentMessage, setParentMessage, examples, onRequestExample, onSubmit,
  inputMode, recState, onCancelRecording, onSwitchToVoice, whisperState, whisperProgress, whisperBackend,
  voiceBackend, partialTranscript,
}: ParentTurnProps) {
  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-6">
      {/* Message box: appears FIRST on mobile so the parent never has to scroll past
          the guides to find it; sits as the right sidebar on desktop. */}
      <div className="order-1 lg:order-2 lg:col-span-2 bg-white rounded-2xl sm:rounded-3xl p-3 sm:p-5 shadow-md border border-slate-200/60 flex flex-col">
        <div className="flex items-center justify-between mb-2 sm:mb-3 gap-2">
          <p className="text-sm sm:text-base font-bold text-slate-600">Your message</p>
          <div className="flex bg-slate-100 rounded-full p-1 text-sm font-bold">
            <button
              onClick={onSwitchToVoice}
              className={`px-3 py-2 sm:py-1 rounded-full transition min-h-[36px] ${inputMode === 'voice' ? 'bg-white shadow text-rose-600' : 'text-slate-500'}`}
              aria-label="Voice input"
            >🎙 Voice</button>
            <button
              onClick={onCancelRecording}
              className={`px-3 py-2 sm:py-1 rounded-full transition min-h-[36px] ${inputMode === 'text' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}
              aria-label="Text input"
            >⌨ Type</button>
          </div>
        </div>

        {inputMode === 'voice' ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-rose-50 border-2 border-dashed border-rose-200 rounded-2xl p-4 sm:p-6 min-h-[140px] sm:min-h-[180px]">
            {voiceBackend === 'webspeech' ? (
              recState === 'recording' ? (
                <>
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-rose-500 flex items-center justify-center shadow-lg animate-pulse mb-2 sm:mb-3">
                    <MicIcon size={32} />
                  </div>
                  <p className="text-rose-600 font-extrabold text-base sm:text-lg">Listening…</p>
                  {partialTranscript ? (
                    <p className="text-sm sm:text-base text-slate-700 mt-2 px-2 italic line-clamp-3">“{partialTranscript}”</p>
                  ) : (
                    <p className="text-[11px] sm:text-xs text-slate-500 mt-1">Speak, then tap <em>Done speaking</em>.</p>
                  )}
                </>
              ) : recState === 'paused' ? (
                <>
                  <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin mb-2 sm:mb-3" />
                  <p className="text-rose-600 font-extrabold text-base sm:text-lg">Finishing…</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-600 font-bold">Allow microphone access in the browser</p>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-2">Native dictation · iOS/Chrome/Edge</p>
                </>
              )
            ) : whisperState === 'transcribing' ? (
              <>
                <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin mb-2 sm:mb-3" />
                <p className="text-rose-600 font-extrabold text-base sm:text-lg">Transcribing…</p>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-1">Whisper-tiny on {whisperBackend}</p>
              </>
            ) : recState === 'recording' ? (
              <>
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-rose-500 flex items-center justify-center shadow-lg animate-pulse mb-2 sm:mb-3">
                  <MicIcon size={32} />
                </div>
                <p className="text-rose-600 font-extrabold text-base sm:text-lg">Listening…</p>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-1">Speak, then tap <em>Done speaking</em>.</p>
              </>
            ) : whisperState === 'loading' ? (
              <>
                <p className="text-sm font-bold text-rose-700 mb-2">Loading speech model… {whisperProgress}%</p>
                <div className="w-full max-w-[220px] h-2 bg-rose-100 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500 transition-all" style={{ width: `${whisperProgress}%` }} />
                </div>
                <p className="text-[10px] text-slate-400 mt-2">~40 MB · cached after first use</p>
              </>
            ) : whisperState === 'error' ? (
              <>
                <p className="text-sm font-bold text-red-600">Speech model failed to load.</p>
                <p className="text-xs text-slate-500 mt-2">Switch to typing to continue.</p>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 font-bold">Allow microphone access in the browser</p>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-2">
                  {whisperState === 'ready' ? `Speech ready · running on ${whisperBackend}` : '…or switch to typing.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <textarea
            className="flex-1 min-h-[120px] sm:min-h-[180px] bg-slate-50 rounded-xl sm:rounded-2xl p-3 sm:p-4 border border-slate-200 focus:border-amber-400 focus:outline-none font-semibold text-slate-700 resize-none text-base"
            placeholder="Type your message to your child…"
            value={parentMessage}
            onChange={(e) => setParentMessage(e.target.value)}
          />
        )}

        <div className="mt-3 sm:mt-4 flex items-center gap-3">
          <button
            onClick={onSubmit}
            disabled={
              whisperState === 'transcribing' ||
              (inputMode === 'text' && !parentMessage.trim()) ||
              (inputMode === 'voice' && recState === 'idle')
            }
            className="pill-btn bg-emerald-500 disabled:bg-slate-300 flex-1 flex items-center justify-center gap-2"
          >
            {inputMode === 'voice'
              ? (whisperState === 'transcribing' ? 'Transcribing…' : <><StopIcon /> Done speaking →</>)
              : 'Send →'}
          </button>
        </div>
        <p className="hidden sm:block text-[10px] text-slate-400 mt-2 text-center">
          Press <kbd className="font-mono bg-slate-100 px-1 rounded">↵</kbd> to send
          {inputMode === 'text' ? ' (with ⌘/Ctrl)' : ''}
        </p>
      </div>

      {/* Guides — simple vertical stack on every screen */}
      <div className="order-2 lg:order-1 lg:col-span-3 space-y-2 sm:space-y-4">
        <p className="text-sm sm:text-base font-bold text-slate-600">💡 Suggested ways to talk to your child</p>
        {guide.guides.map((g) => {
          const cat = Array.isArray(g.category) ? g.category.join(', ') : g.category;
          const ex = examples[g.id];
          return (
            <div key={g.id} className="guide-card !p-3 sm:!p-5">
              <p className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-slate-400">{cat} · {g.type}</p>
              <p className="text-base sm:text-lg font-bold text-slate-800 mt-0.5 sm:mt-1 mb-1.5 sm:mb-2">{g.guide}</p>
              {g.type === 'messaging' && (
                ex && ex !== '__loading__' ? (
                  <>
                    <div className="text-sm bg-slate-50 rounded-lg p-3 border border-slate-200 italic text-slate-700 mb-2">{ex}</div>
                    <div className="flex gap-3 flex-wrap">
                      <button onClick={() => speak(ex)} className="text-xs font-bold text-emerald-600 active:text-emerald-800 px-2 py-1.5 -ml-2">🔊 Hear again</button>
                      <button onClick={() => setParentMessage(ex)} className="text-xs font-bold text-blue-600 active:text-blue-800 px-2 py-1.5">→ Use this</button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => onRequestExample(g.id)}
                    disabled={ex === '__loading__'}
                    className="text-xs font-bold text-amber-600 active:text-amber-800 disabled:opacity-50 px-2 py-1.5 -ml-2"
                  >
                    {ex === '__loading__' ? 'Generating…' : '🔊 Generate example utterance'}
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChildTurnProps {
  rec: ChildCardRecommendationResult;
  interim: CardInfo[];
  onCardClick: (c: CardInfo) => void;
  onPop: () => void;
  onRefresh: () => void;
  onConfirm: () => void;
  busy: boolean;
  parentMessage: string | null;
}

function ChildTurn({
  rec, interim, onCardClick, onPop, onRefresh, onConfirm, busy, parentMessage,
}: ChildTurnProps) {
  const byCat = useMemo(() => {
    const groups: Record<CardInfo['category'], CardInfo[]> = { topic: [], action: [], emotion: [], core: [] };
    for (const c of rec.cards) (groups[c.category] ||= []).push(c);
    return groups;
  }, [rec]);

  const mainCats: Array<{ key: 'topic' | 'action' | 'emotion'; label: string; tint: string }> = [
    { key: 'topic',   label: 'Topic',   tint: 'bg-card-topic/40   border-sky-200' },
    { key: 'action',  label: 'Action',  tint: 'bg-card-action/40  border-orange-200' },
    { key: 'emotion', label: 'Feeling', tint: 'bg-card-emotion/40 border-rose-200' },
  ];

  return (
    <div className="w-full flex flex-col items-stretch gap-3 sm:gap-5">
      {/* Parent's last message — what the child is responding to */}
      {parentMessage && (
        <div className="bg-blue-50 border-l-4 border-blue-400 rounded-xl px-3 sm:px-4 py-2 sm:py-3 shadow-sm">
          <div className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-widest text-blue-600 mb-0.5 sm:mb-1">Parent said</div>
          <div className="text-sm sm:text-base font-bold text-slate-800 leading-snug">{parentMessage}</div>
        </div>
      )}

      {/* Selected-card deck. Tapping a card adds it; tap Done ✓ to send to parent. */}
      <div className="bg-amber-50/80 border-2 border-dashed border-amber-300 rounded-2xl sm:rounded-3xl p-2 sm:p-3 min-h-[80px] sm:min-h-[112px] shadow-sm">
        <div className="flex items-center mb-1.5 sm:mb-2">
          <span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-widest text-amber-700">Your selection</span>
          <button
            onClick={onPop}
            disabled={interim.length === 0 || busy}
            className="ml-auto text-xs font-bold text-amber-700 active:text-amber-900 disabled:opacity-30 px-2 py-1 -my-1"
          >← undo</button>
        </div>
        {interim.length === 0 ? (
          <p className="italic text-slate-400 text-xs sm:text-sm">Tap cards below to build your sentence…</p>
        ) : (
          <div className="flex gap-2 flex-wrap items-end">
            {interim.map((c, i) => (
              <CardChip key={`${c.id}-${i}`} card={c} size="sm" onClick={() => speakCard(c)} />
            ))}
          </div>
        )}
      </div>

      {/* Main: 3 category columns side-by-side, mimicking RN client */}
      <div className="relative">
        {busy && (
          <div className="absolute inset-0 z-10 bg-white/70 backdrop-blur-[1px] rounded-2xl flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 sm:gap-3 bg-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-full shadow border">
              <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-slate-300 border-t-amber-400 rounded-full animate-spin" />
              <span className="text-xs sm:text-sm font-bold text-slate-600">Regenerating…</span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-3 md:gap-4">
          {mainCats.map(({ key, label, tint }) => (
            <div key={key} className={`${tint} border rounded-xl sm:rounded-2xl p-1.5 sm:p-3`}>
              <p className="text-center text-[11px] sm:text-base md:text-lg font-extrabold text-slate-700 mb-1.5 sm:mb-3">{label}</p>
              {/* 1 col on phones (cards stack), 2 cols ≥ sm (RN-style slicedCardIds) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 justify-items-center">
                {byCat[key].map(c => (
                  <CardChip key={c.id} card={c} size="md" onClick={() => !busy && onCardClick(c)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: core cards row (Yes / No / IDK / How about you) — horizontal scroll on phones */}
      {byCat.core.length > 0 && (
        <div className="flex justify-start sm:justify-center gap-2 sm:gap-3 flex-nowrap sm:flex-wrap overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-1">
          {byCat.core.map(c => (
            <div key={c.id} className="shrink-0">
              <CardChip card={c} size="md" onClick={() => !busy && onCardClick(c)} />
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
        <button
          onClick={onRefresh}
          disabled={busy}
          className="pill-btn bg-slate-500 disabled:opacity-40 text-sm sm:text-base px-4 sm:px-8 py-2 sm:py-3"
          title="Generate fresh cards"
        >↻ Refresh</button>
        <button
          onClick={onConfirm}
          disabled={interim.length === 0 || busy}
          className="pill-btn bg-emerald-500 disabled:opacity-40 text-base px-8 sm:px-10 py-3 shadow-lg"
        >Done ✓</button>
      </div>
    </div>
  );
}
