import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { analytics } from '../api/analytics';
import { HillBackground } from '../components/HillBackground';
import { TurnBanner } from '../components/TurnBanner';
import { RecordingPill } from '../components/RecordingPill';
import { CardChip } from '../components/CardChip';
import { CloseIcon, MenuIcon, MicIcon, StopIcon, StarIcon } from '../components/Icons';
import { CardSearchOverlay } from '../components/CardSearchOverlay';
import { MicRecorder } from '../audio/recorder';
import { speak, speakCard, stopSpeaking } from '../audio/tts';
import { getMuted } from '../audio/mute';
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
  const [showSearch, setShowSearch] = useState(false);
  const [turnNumber, setTurnNumber] = useState(0);
  const [lastParentMessage, setLastParentMessage] = useState<string | null>(null);
  const [inferredSentence, setInferredSentence] = useState<string | null>(null);
  const [micTapCount, setMicTapCount] = useState(0);

  // Recording
  const [recState, setRecState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [recLevel, setRecLevel] = useState(0);
  const recRef = useRef<MicRecorder | null>(null);

  // Input mode: voice (default) or text
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');

  // Voice transcription. Two backends:
  //   1. Web Speech API (preferred -- native iOS dictation / Chrome / Edge / Safari)
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
  }, [phase, role, inputMode, useWebSpeech, micTapCount]);

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

  // ----- Submit parent message -----
  const submitParent = useCallback(async () => {
    if (!sessionId) return;
    const text = (partialTranscript.trim() || parentMessage.trim());
    if (!text) return;

    // Abort any active recording cleanly before submitting
    if (useWebSpeech && webSpeechRef.current?.getState() !== 'idle') {
      webSpeechRef.current?.abort();
      webSpeechResultRef.current = null;
    }
    const r = recRef.current;
    if (r && r.getState() !== 'idle') await r.stop(true).catch(() => {});
    setPartialTranscript('');

    analytics.parentMessageSend(sessionId);
    try {
      setPhase('thinking');
      setPhaseLabel('Generating cards for the child…');
      const result = await api.sendParentText(sessionId, text);
      setTurnId(result.next_turn_id);
      setRole('child');
      setChildRec(result.payload);
      setInterimCards([]);
      setLastParentMessage(text);
      setParentMessage('');
      setTurnNumber(n => n + 1);
      setPhase('idle');
      refreshDialogue();
    } catch (e: any) {
      setErrorMsg(e?.response?.data?.detail || e?.message || 'Failed to submit');
      setPhase('idle');
    }
  }, [sessionId, parentMessage, partialTranscript, useWebSpeech, refreshDialogue]);

  // ----- Mic tap: first tap starts, second tap stops (text stays in box), third tap restarts -----
  const handleMicTap = useCallback(async () => {
    if (recState === 'recording') {
      // Stop → put final text in the box, don't submit
      if (useWebSpeech && webSpeechRef.current?.getState() === 'listening') {
        webSpeechRef.current.stop();
        const text = ((await webSpeechResultRef.current) ?? '').trim();
        webSpeechResultRef.current = null;
        setPartialTranscript('');
        setParentMessage(text);
      } else if (recRef.current && recRef.current.getState() !== 'idle') {
        await recRef.current.stop(true).catch(() => {});
      }
    } else {
      // Start (or restart) -- clear box and begin fresh recording
      setParentMessage('');
      setPartialTranscript('');
      if (inputMode === 'voice') {
        setMicTapCount(c => c + 1); // force useEffect cleanup + restart
      } else {
        if (!useWebSpeech) ensureWhisper();
        setInputMode('voice');
      }
    }
  }, [recState, useWebSpeech, inputMode, ensureWhisper]);

  // ----- Child interactions -----
  // We use OPTIMISTIC updates: update the selection deck instantly so the user sees
  // their tap immediately, while the backend regenerates the next card recommendation
  // (an LLM call) in the background and we render a subtle overlay on the card grid.
  const [refreshingCards, setRefreshingCards] = useState(false);

  // Tap appends to the child's interim selection; the screen does NOT switch turns
  // until they tap the explicit Done ✓ button. (Auto-confirm-on-tap was tried and
  // pulled -- on touch screens an instant role flip felt like a crash.)
  const onCardClick = useCallback(async (card: CardInfo) => {
    if (!sessionId || role !== 'child') return;
    analytics.cardTap(sessionId, card.label);
    speakCard(card);
    setInterimCards(prev => [...prev, card]); // optimistic -- instant UI update
    try {
      const r = await api.addChildCard(sessionId, card);
      setInterimCards(r.interim_cards); // reconcile with server
      // new_recommendation is unchanged from server (no auto-regen), skip childRec update
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to add card');
      setInterimCards(prev => prev.filter(c => c.id !== card.id)); // revert optimistic
    }
  }, [sessionId, role]);

  const onSearchSelect = useCallback(async (word: string, category: string, image_url: string | null) => {
    if (!sessionId || role !== 'child') return;
    const optimistic: CardInfo = {
      id: `free-${Date.now()}`, recommendation_id: 'free',
      label: word, label_localized: word, category: category as any,
      corpus_name: word, corpus_image_url: image_url,
    };
    speakCard(optimistic);
    setInterimCards(prev => [...prev, optimistic]);
    try {
      const r = await api.addFreeCard(sessionId, word, category, image_url);
      setInterimCards(r.interim_cards);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to add card');
      setInterimCards(prev => prev.filter(c => c.id !== optimistic.id));
    }
  }, [sessionId, role]);

  const onRemoveCard = useCallback(async (index: number) => {
    if (!sessionId || index < 0) return;
    setInterimCards(prev => prev.filter((_, i) => i !== index)); // optimistic
    try {
      const r = await api.removeCard(sessionId, index);
      setInterimCards(r.interim_cards); // reconcile
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to remove card');
    }
  }, [sessionId]);

  // Step 1: infer sentence from selected cards, show approval overlay
  const onConfirm = useCallback(async () => {
    if (!sessionId || interimCards.length === 0) return;
    analytics.cardConfirm(sessionId);
    setPhase('thinking');
    setPhaseLabel('Figuring out what you want to say…');
    try {
      const { sentence } = await api.inferSentence(sessionId);
      setInferredSentence(sentence);
      setPhase('idle');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to infer sentence');
      setPhase('idle');
    }
  }, [sessionId, interimCards]);

  // Step 2a: child approves → generate parent guides
  const onAcceptSentence = useCallback(async () => {
    if (!sessionId) return;
    setInferredSentence(null);
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
  }, [sessionId, refreshDialogue]);

  // Step 2b: child rejects → stay on child turn, keep cards
  const onRejectSentence = useCallback(() => {
    setInferredSentence(null);
  }, []);

  const onRefreshCards = useCallback(async () => {
    if (!sessionId || refreshingCards) return;
    analytics.cardRefresh(sessionId);
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
    analytics.guideExampleExpand(sessionId);
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
    analytics.sessionEnd(sessionId);
    stopSpeaking();
    if (recRef.current) await recRef.current.stop(true).catch(() => {});
    setShowMenu(false);
    setPhase('closing');
    try { await api.endSession(sessionId); } catch {}
    nav(`/session-end/${encodeURIComponent(sessionId)}`, { replace: true });
  }
  async function abortSession() {
    if (!sessionId) { nav('/home', { replace: true }); return; }
    analytics.sessionAbort(sessionId);
    stopSpeaking();
    if (recRef.current) await recRef.current.stop(true).catch(() => {});
    try { await api.abortSession(sessionId); } catch {}
    nav('/home', { replace: true });
  }

  // ----- Keyboard: Enter advances; Esc opens menu (or rejects sentence) -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // When sentence approval overlay is open, Enter = yes, Escape = no
      if (inferredSentence) {
        if (e.key === 'Enter') { e.preventDefault(); onAcceptSentence(); }
        if (e.key === 'Escape') { e.preventDefault(); onRejectSentence(); }
        return;
      }
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
  }, [phase, role, submitParent, onConfirm, interimCards, inferredSentence, onAcceptSentence, onRejectSentence]);

  const stars = useMemo(() => Array.from({ length: Math.floor((turnNumber - 1) / 2) }), [turnNumber]);

  return (
    <HillBackground topic={topic.category} calm>
      <div className="h-screen overflow-hidden px-3 sm:px-4 pt-3 flex flex-col items-center relative safe-top">
        <RecordingPill state={recState} level={recLevel} />

        {/* Transcript toggle */}
        <div className="absolute top-2 left-2 sm:top-4 sm:left-4 z-10">
          <button
            onClick={() => setShowDialogue(s => !s)}
            className="text-sm sm:text-base font-bold px-4 py-2 rounded-full bg-white shadow-md border-2 border-slate-200 text-slate-700 hover:bg-slate-50 active:scale-95 motion-reduce:active:scale-100 transition-all duration-300 ease-in-out"
          >
            Transcript
          </button>
        </div>

        {/* Turn banner + stars -- single horizontal row to save vertical space on iPad landscape */}
        <div className="mt-2 flex flex-row items-center justify-center gap-2 sm:gap-3 flex-wrap z-10 flex-shrink-0">
          <TurnBanner role={role} topic={topic.category} subtopic={topic.subtopic} turnNumber={turnNumber} />
          {stars.length > 0 && (
            <div className="flex items-center gap-0.5">
              {stars.slice(0, 6).map((_, i) => <StarIcon key={i} size={20} />)}
              {stars.length > 6 && <span className="text-xs font-bold text-amber-700 ml-1">+{stars.length - 6}</span>}
            </div>
          )}
        </div>

        {/* Center content */}
        <div className="flex-1 min-h-0 self-stretch flex flex-col items-stretch max-w-5xl w-full mx-auto mt-2 overflow-hidden">
          {(phase === 'init' || phase === 'thinking' || phase === 'closing') && (
            <div className="flex-1 flex items-center justify-center">
              <Loader label={phaseLabel} />
            </div>
          )}

          {phase === 'idle' && role === 'parent' && parentGuide && (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center overflow-y-auto">
              <ParentTurn
                topic={topic.category}
                parentMessage={parentMessage}
                setParentMessage={setParentMessage}
                onSubmit={submitParent}
                isRecording={recState === 'recording'}
                partialTranscript={partialTranscript}
                onMicTap={handleMicTap}
              />
            </div>
          )}

          {phase === 'idle' && role === 'child' && childRec && (
            <ChildTurn
              rec={childRec}
              interim={interimCards}
              onCardClick={onCardClick}
              onRemoveCard={onRemoveCard}
              onRefresh={onRefreshCards}
              onConfirm={onConfirm}
              busy={refreshingCards}
              onSearchOpen={() => { analytics.cardSearchOpen(sessionId!); setShowSearch(true); }}
            />
          )}
        </div>

        {/* Sentence acceptance full-screen */}
        {inferredSentence && (
          <SentenceAcceptance
            sentence={inferredSentence}
            onAccept={onAcceptSentence}
            onReject={onRejectSentence}
            onRetry={onConfirm}
          />
        )}

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
          style={{ bottom: 'max(4.5rem, calc(env(safe-area-inset-bottom) + 3.5rem))' }}
        >
          ↵ to advance · Esc for menu
        </div>

        {showDialogue && (
          <div
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setShowDialogue(false)}
          >
            <div
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[70dvh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h3 className="text-xl font-extrabold text-slate-800">Transcript</h3>
                <button
                  onClick={() => setShowDialogue(false)}
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors duration-300 ease-in-out"
                  aria-label="Close transcript"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="overflow-y-auto p-5 flex-1">
                {dialogue.length === 0 ? (
                  <p className="text-slate-400 italic text-center py-8">Nothing said yet.</p>
                ) : (
                  <div className="space-y-2">
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
            </div>
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

        {showSearch && (
          <CardSearchOverlay
            onSelect={onSearchSelect}
            onClose={() => setShowSearch(false)}
          />
        )}
      </div>
    </HillBackground>
  );
}

function Loader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <div className="w-16 h-16 border-4 border-slate-300 border-t-amber-400 rounded-full animate-spin motion-reduce:animate-none" />
      <p className="text-base font-bold text-slate-600">{label}</p>
    </div>
  );
}

// Idle mic button borrows each topic's accent color so it reads as inviting
// rather than alarming; red is reserved for the active-recording state, matching
// the universal "REC" convention (camera/voice apps) instead of a "danger" cue.
const MIC_ACCENT: Record<TopicCategory, { light: string; dark: string; shadow: string }> = {
  plan:   { light: '#8AB8FF', dark: '#4C7EF0', shadow: 'rgba(76,126,240,0.45)' },
  recall: { light: '#7BE065', dark: '#35B31C', shadow: 'rgba(53,179,28,0.45)' },
  free:   { light: '#FFB273', dark: '#F3862B', shadow: 'rgba(243,134,43,0.45)' },
};

interface ParentTurnProps {
  topic: TopicCategory;
  parentMessage: string;
  setParentMessage: (s: string) => void;
  onSubmit: () => void;
  isRecording: boolean;
  partialTranscript: string;
  onMicTap: () => void;
}

function ParentTurn({
  topic, parentMessage, setParentMessage, onSubmit,
  isRecording, partialTranscript, onMicTap,
}: ParentTurnProps) {
  const displayValue = isRecording ? partialTranscript : parentMessage;
  const canSend = !!(parentMessage.trim() || (isRecording && partialTranscript.trim()));
  const accent = MIC_ACCENT[topic];
  // Accessibility text-size setting (src/uiScale.ts) -- scales the reading/
  // interaction surfaces that matter most here: the heading, the mic status
  // label, and the textarea. The `ui-scale-*` marker classes below are picked
  // up by matching rules in styles.css (kept in lockstep with each element's
  // existing Tailwind breakpoints), so responsiveness is preserved and at the
  // "Normal" level this renders byte-for-byte the same as before.

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6 max-w-2xl mx-auto px-4">
      {/* Heading */}
      <h2 className="ui-scale-heading text-2xl sm:text-3xl font-bold text-slate-600 text-center">
        Type or speak to say a sentence.
      </h2>

      {/* Mic button with outward ripple rings */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
          {isRecording && (
            <span className="absolute inset-0 rounded-full mic-ripple" style={{ color: '#e11d48' }} />
          )}
          <button
            onClick={onMicTap}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            className={`relative z-10 flex items-center justify-center active:scale-95 motion-reduce:active:scale-100 transition-transform duration-300 ease-in-out ${isRecording ? 'mic-breathe' : ''}`}
            style={{
              width: 170, height: 170,
              borderRadius: '50%',
              background: isRecording
                ? 'linear-gradient(135deg, #fb7185, #e11d48)'
                : `linear-gradient(135deg, ${accent.light}, ${accent.dark})`,
            }}
          >
            {isRecording
              ? <div className="w-14 h-14 rounded-xl bg-white" />
              : <MicIcon size={80} color="#fff" />
            }
          </button>
        </div>
        <p className="ui-scale-mic-label text-xl sm:text-2xl font-bold text-slate-500 select-none">
          {isRecording ? 'Listening... tap to stop' : 'Tap to speak'}
        </p>
      </div>

      {/* Divider */}
      <p className="text-xl font-semibold text-slate-400 select-none">or</p>

      {/* Textbox */}
      <textarea
        className="ui-scale-textarea w-full bg-white rounded-2xl p-5 border-2 border-slate-200 focus:border-red-400 focus:outline-none font-medium text-slate-700 resize-none text-xl placeholder-slate-300 shadow-sm"
        style={{ height: 130 }}
        placeholder="Start typing here..."
        value={displayValue}
        readOnly={isRecording}
        onChange={e => { if (!isRecording) setParentMessage(e.target.value); }}
      />

      {/* Send */}
      <button
        onClick={onSubmit}
        disabled={!canSend}
        className="pill-btn bg-emerald-500 disabled:bg-slate-300 w-full text-2xl py-5"
      >
        Send
      </button>
    </div>
  );
}

interface ChildTurnProps {
  rec: ChildCardRecommendationResult;
  interim: CardInfo[];
  onCardClick: (c: CardInfo) => void;
  onRemoveCard: (index: number) => void;
  onRefresh: () => void;
  onConfirm: () => void;
  busy: boolean;
  onSearchOpen: () => void;
}

function ChildTurn({
  rec, interim, onCardClick, onRemoveCard, onRefresh, onConfirm,
  busy, onSearchOpen,
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
    <div className="flex-1 min-h-0 flex flex-col items-stretch gap-2">

      {/* Selected-card deck -- fixed height, horizontal scroll, text pills */}
      <div className="flex-shrink-0 h-[72px] bg-amber-50/80 border-2 border-dashed border-amber-300 rounded-2xl px-3 py-2 shadow-sm flex flex-col justify-center gap-1.5">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700 leading-none flex-shrink-0">
          Your selection {interim.length > 0 && <span className="font-normal normal-case">(tap to remove)</span>}
        </span>
        {interim.length === 0 ? (
          <p className="italic text-slate-400 text-xs">Tap cards below to build your sentence…</p>
        ) : (
          <div className="flex gap-2 items-center overflow-x-auto">
            {interim.map((c, i) => (
              <button
                key={`${c.id}-${i}`}
                onClick={() => onRemoveCard(i)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-amber-300 rounded-full text-sm font-bold text-slate-700 shadow-sm active:scale-95 transition-transform"
                style={{ touchAction: 'manipulation' }}
              >
                {c.corpus_name ?? c.label}
                <span className="text-red-400 text-[11px] font-extrabold">✕</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main: 3 category columns side-by-side, fills remaining space */}
      <div className="relative flex-1 min-h-0">
        {busy && (
          <div className="absolute inset-0 z-10 bg-white/70 backdrop-blur-[1px] rounded-2xl flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow border">
              <div className="w-5 h-5 border-2 border-slate-300 border-t-amber-400 rounded-full animate-spin" />
              <span className="text-sm font-bold text-slate-600">Regenerating…</span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 h-full">
          {mainCats.map(({ key, label, tint }) => (
            <div key={key} className={`${tint} border rounded-2xl p-2 sm:p-3 flex flex-col`}>
              <p className="text-center text-sm sm:text-base font-extrabold text-slate-700 mb-2 flex-shrink-0">{label}</p>
              <div className="flex-1 grid grid-cols-2 gap-2 content-start justify-items-center">
                {byCat[key].map(c => (
                  <CardChip key={c.id} card={c} size="lg" onClick={() => !busy && onCardClick(c)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: core cards + "View all words" search card */}
      <div className="flex-shrink-0 flex justify-start sm:justify-center gap-2 sm:gap-3 flex-nowrap overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        {byCat.core.map(c => (
          <div key={c.id} className="shrink-0">
            <CardChip card={c} size="md" onClick={() => !busy && onCardClick(c)} />
          </div>
        ))}
        <div className="shrink-0">
          <button
            onClick={onSearchOpen}
            style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
            className="w-[72px] h-24 sm:w-24 sm:h-28 flex flex-col items-center justify-between rounded-2xl bg-white border-2 border-slate-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-1 active:scale-95 transition-all duration-150 p-2 pt-1.5 pb-1.5 select-none cursor-pointer"
          >
            <div className="flex-1 w-full rounded-xl flex items-center justify-center bg-slate-100">
              <span className="text-3xl leading-none" role="img" aria-label="Search all words">🔍</span>
            </div>
            <div className="w-full mt-1.5 px-0.5 text-center leading-tight">
              <div className="text-xs sm:text-sm font-bold text-slate-500 line-clamp-2">View all words</div>
            </div>
          </button>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex-shrink-0 flex flex-wrap justify-center gap-2 sm:gap-3 pb-2">
        <button
          onClick={onRefresh}
          disabled={busy}
          className="pill-btn bg-slate-500 disabled:opacity-40 text-sm sm:text-base px-4 sm:px-8 py-2 sm:py-3"
        >↻ Refresh</button>
        <button
          onClick={onConfirm}
          disabled={interim.length === 0 || busy}
          className="pill-btn bg-emerald-500 disabled:opacity-40 text-base px-8 sm:px-10 py-3 shadow-lg"
        >Generate sentence</button>
      </div>
    </div>
  );
}

function SentenceAcceptance({
  sentence, onAccept, onReject, onRetry,
}: {
  sentence: string;
  onAccept: () => void;
  onReject: () => void;
  onRetry: () => void;
}) {
  const [playState, setPlayState] = useState<'idle' | 'playing' | 'done'>('idle');

  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  function handlePlay() {
    if (playState === 'playing') return;
    window.speechSynthesis?.cancel();
    if (getMuted()) { setPlayState('done'); return; }
    const utter = new SpeechSynthesisUtterance(sentence);
    utter.onend = () => setPlayState('done');
    utter.onerror = () => setPlayState('done');
    window.speechSynthesis?.speak(utter);
    setPlayState('playing');
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center gap-10 px-8">
      <h2 className="text-5xl font-extrabold text-slate-700">You said</h2>

      <div className="w-full max-w-xl border-2 border-blue-200 rounded-3xl p-8 bg-blue-50/50 shadow-sm">
        <p className="text-4xl font-bold text-slate-700 text-center leading-snug">{sentence}</p>
      </div>

      {/* Play / Replay button */}
      <button
        onClick={handlePlay}
        disabled={playState === 'playing'}
        className="flex flex-col items-center gap-3 active:scale-95 motion-reduce:active:scale-100 transition-transform duration-300 ease-in-out disabled:opacity-60"
        aria-label={playState === 'done' ? 'Play again' : 'Play sentence'}
      >
        <div
          className="w-32 h-32 rounded-full flex items-center justify-center transition-colors duration-300 ease-in-out"
          style={{
            background: playState === 'playing'
              ? '#a78bfa'
              : 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
          }}
        >
          {playState === 'idle' && (
            <span className="text-6xl text-white" style={{ paddingLeft: 6 }}>▶</span>
          )}
          {playState === 'playing' && (
            <div className="flex gap-2 items-center">
              <div className="w-3 h-10 bg-white rounded-full animate-bounce motion-reduce:animate-none" style={{ animationDelay: '0ms' }} />
              <div className="w-3 h-10 bg-white rounded-full animate-bounce motion-reduce:animate-none" style={{ animationDelay: '150ms' }} />
              <div className="w-3 h-10 bg-white rounded-full animate-bounce motion-reduce:animate-none" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {playState === 'done' && (
            <span className="text-5xl text-white">↺</span>
          )}
        </div>
        <span className="text-2xl font-bold text-slate-500 select-none">
          {playState === 'idle' ? 'Play' : playState === 'playing' ? 'Playing…' : 'Play again'}
        </span>
      </button>

      {/* no / try again / yes */}
      <div className="flex gap-4 w-full max-w-xl">
        <button
          onClick={onReject}
          className="flex-1 py-7 rounded-3xl text-3xl font-extrabold border-2 border-red-300 text-red-500 bg-white active:bg-red-50 transition-colors duration-300 ease-in-out shadow-sm"
        >no</button>
        <button
          onClick={onRetry}
          className="flex-1 py-7 rounded-3xl text-3xl font-extrabold border-2 border-yellow-300 text-yellow-600 bg-white active:bg-yellow-50 transition-colors duration-300 ease-in-out shadow-sm"
        >try again</button>
        <button
          onClick={onAccept}
          className="flex-1 py-7 rounded-3xl text-3xl font-extrabold border-2 border-green-300 text-green-600 bg-white active:bg-green-50 transition-colors duration-300 ease-in-out shadow-sm"
        >yes</button>
      </div>
    </div>
  );
}
