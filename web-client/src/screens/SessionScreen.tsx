import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/local';
import { engine } from '../engine/model';
import { getProfile, setProfile } from '../engine/store';
import { TurnBanner } from '../components/TurnBanner';
import { TranscriptMessages } from '../components/Transcript';
import { CardChip } from '../components/CardChip';
import { CloseIcon, MenuIcon, MicIcon } from '../components/Icons';
import { CardSearchOverlay } from '../components/CardSearchOverlay';
import { Spinner } from '../components/Spinner';
import { CompactSession } from './CompactSession';
import { SessionMenu } from '../components/SessionMenu';
import { AskPanel } from '../components/AskPanel';
import { FORM_LABELS, formsFor, inflect, type WordForm } from '../engine/grammar';
import { SETTINGS } from '../engine/settings';
import { speak, speakCard, stopSpeaking } from '../audio/tts';
import { WebSpeechRecognizer, isWebSpeechSupported } from '../audio/webspeech';
import type { CardInfo, ChildCardRecommendationResult, DialogueRole, DialogueMessage } from '../api/types';

type Phase = 'init' | 'idle' | 'thinking' | 'closing';

// Zoom-to-fit: the session screen is laid out on a canvas of at least DESIGN_W x DESIGN_H CSS pixels
// (an iPad-sized board) and scaled down as a whole on smaller viewports such as an iPhone in landscape,
// so nothing overflows or needs scrolling. Larger viewports get scale 1 and the canvas simply grows.
const DESIGN_W = 1024, DESIGN_H = 880;
function fitFor(vw: number, vh: number) {
  const s = Math.min(1, vw / DESIGN_W, vh / DESIGN_H);
  return { s, vw, vh, cw: vw / s, ch: vh / s };
}
// The size comes from the fixed full-viewport root element (measured with ResizeObserver), not from
// window.innerHeight, which iPad Safari misreports in full-screen mode and leaves a gap at the bottom.
function useFitScale(rootRef: React.RefObject<HTMLDivElement>) {
  const [st, setSt] = useState(() => fitFor(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const el = rootRef.current;
    const measure = () => {
      const r = el?.getBoundingClientRect();
      const vw = r && r.width > 0 ? r.width : window.innerWidth;
      const vh = r && r.height > 0 ? r.height : window.innerHeight;
      setSt(prev => (prev.vw === vw && prev.vh === vh) ? prev : fitFor(vw, vh));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(measure) : null;
    ro?.observe(el!);
    window.addEventListener('resize', measure); window.addEventListener('orientationchange', measure); window.visualViewport?.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('orientationchange', measure); window.visualViewport?.removeEventListener('resize', measure); };
  }, [rootRef]);
  useEffect(() => {
    document.documentElement.style.setProperty('--fit-scale', String(st.s));
    return () => { document.documentElement.style.removeProperty('--fit-scale'); };
  }, [st.s]);
  return st;
}


export function SessionScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const nav = useNavigate();

  const [phase, setPhase] = useState<Phase>('init');
  const [phaseLabel, setPhaseLabel] = useState('Starting your session…');
  const [role, setRole] = useState<DialogueRole>('parent');
  const [started, setStarted] = useState(false);
  const [childRec, setChildRec] = useState<ChildCardRecommendationResult | null>(null);
  const [interimCards, setInterimCardsState] = useState<CardInfo[]>([]);
  const interimCardsRef = useRef<CardInfo[]>([]);
  const setInterimCards = useCallback((updater: CardInfo[] | ((prev: CardInfo[]) => CardInfo[])) => {
    const next = typeof updater === 'function' ? (updater as (prev: CardInfo[]) => CardInfo[])(interimCardsRef.current) : updater;
    interimCardsRef.current = next;
    setInterimCardsState(next);
  }, []);
  const [dialogue, setDialogue] = useState<DialogueMessage[]>([]);
  const [parentMessage, setParentMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showDialogue, setShowDialogue] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [scopedFolderPath, setScopedFolderPath] = useState<string[] | undefined>(undefined);
  // "More ideas": the next 60 suggested cards as a folder page, refreshed whenever the browser opens
  const [moreRows, setMoreRows] = useState<{ folder: string; word: string; image_url: string | null; emoji?: string }[]>([]);
  const onMoreOpen = useCallback(() => { setMoreRows(api.moreSuggestions()); setScopedFolderPath(['More ideas']); setShowSearch(true); }, []);
  const [lastParentMessage, setLastParentMessage] = useState<string | null>(null);
  const [bankedChildSentences, setBankedChildSentences] = useState<string[]>([]);
  const [inferredSentence, setInferredSentence] = useState<string | null>(null);
  const [hasBankedSentence, setHasBankedSentence] = useState(false);
  const [micTapCount, setMicTapCount] = useState(0);
  const [setting, setSetting] = useState(getProfile().setting || 'home');
  // Where the conversation happens: saved to the profile, fed to the model prompt, cards re-predicted.
  const changeSetting = useCallback(async (v: string) => {
    setSetting(v); setProfile({ ...getProfile(), setting: v });
    if (role === 'child' && childRec) {
      setRefreshingCards(true);
      try { const r = await api.repredict(); if (r) setChildRec(r); } finally { setRefreshingCards(false); }
    }
  }, [role, childRec]);

  // Voice input: the browser's Web Speech API (native dictation on iOS / Chrome / Edge / Safari).
  const [recState, setRecState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');
  const useWebSpeech = isWebSpeechSupported();
  const webSpeechRef = useRef<WebSpeechRecognizer | null>(null);
  if (useWebSpeech && !webSpeechRef.current) webSpeechRef.current = new WebSpeechRecognizer();
  const [partialTranscript, setPartialTranscript] = useState('');
  const webSpeechResultRef = useRef<Promise<string> | null>(null);

  const startedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fit = useFitScale(rootRef);
  // Phones (either orientation) and small tablets get the compact layout; larger screens keep the board.
  const compact = fit.vw < 900 || fit.vh < 600;
  const landscape = fit.vw > fit.vh;
  useEffect(() => {
    document.documentElement.classList.add('session-active');
    return () => { document.documentElement.classList.remove('session-active'); };
  }, []);

  // ----- Lifecycle: start the session (waits for the on-device model to finish loading) -----
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;
    engine.onProgress = p => setPhaseLabel(engine.ready ? 'Starting your session…' : p.msg);
    (async () => {
      try {
        setPhaseLabel(engine.ready ? 'Starting your session…' : engine.progress.msg);
        await api.startSession(sessionId);
        setRole('parent');
        setStarted(true);
        setPhase('idle');
      } catch (e: any) {
        setErrorMsg(e?.message || 'Failed to start session');
      }
    })();
    return () => { engine.onProgress = () => {}; };
  }, [sessionId]);

  // ----- Auto-record on parent turn (voice mode) -----
  useEffect(() => {
    let cancelled = false;
    if (phase === 'idle' && role === 'parent' && inputMode === 'voice' && useWebSpeech && webSpeechRef.current) {
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
    }
    return () => {
      cancelled = true;
      if (useWebSpeech && webSpeechRef.current?.getState() !== 'idle') webSpeechRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, role, inputMode, useWebSpeech, micTapCount]);

  const refreshDialogue = useCallback(async () => {
    if (!sessionId) return;
    try { const r = await api.getDialogue(sessionId); setDialogue(r.dialogue); } catch {}
  }, [sessionId]);

  // ----- Submit parent message -----
  const submitParent = useCallback(async (override?: string) => {
    if (!sessionId) return;
    const text = (typeof override === 'string' ? override : (partialTranscript.trim() || parentMessage.trim())).trim();
    if (!text) return;
    if (useWebSpeech && webSpeechRef.current?.getState() !== 'idle') {
      webSpeechRef.current?.abort();
      webSpeechResultRef.current = null;
    }
    setPartialTranscript('');
    try {
      setPhase('thinking');
      setPhaseLabel('Generating cards for the child…');
      const result = await api.sendParentText(sessionId, text);
      setRole('child');
      setChildRec(result.payload);
      setInterimCards([]);
      setHasBankedSentence(false);
      setBankedChildSentences([]);
      setLastParentMessage(text);
      setParentMessage('');
      setPhase('idle');
      refreshDialogue();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to submit');
      setPhase('idle');
    }
  }, [sessionId, parentMessage, partialTranscript, useWebSpeech, refreshDialogue, setInterimCards]);

  // ----- Mic tap: first tap starts, second tap stops (text stays in box), third tap restarts -----
  const handleMicTap = useCallback(async () => {
    if (!useWebSpeech) { setErrorMsg('Voice input is not supported in this browser — please type instead.'); return; }
    if (recState === 'recording') {
      if (webSpeechRef.current?.getState() === 'listening') {
        webSpeechRef.current.stop();
        const text = ((await webSpeechResultRef.current) ?? '').trim();
        webSpeechResultRef.current = null;
        setPartialTranscript('');
        setParentMessage(text);
      }
    } else {
      setParentMessage('');
      setPartialTranscript('');
      if (inputMode === 'voice') setMicTapCount(c => c + 1);
      else setInputMode('voice');
    }
  }, [recState, useWebSpeech, inputMode]);

  // ----- Child interactions -----
  // Optimistic: the tapped card shows in the selection instantly while the on-device model
  // predicts the next cards for the new prefix (a few hundred ms) behind a subtle overlay.
  const [refreshingCards, setRefreshingCards] = useState(false);

  const onCardClick = useCallback(async (card: CardInfo) => {
    if (!sessionId || role !== 'child') return;
    if (card.is_folder && card.folder_path) {
      setScopedFolderPath(card.folder_path.split(' > '));
      setShowSearch(true);
      return;
    }
    speakCard(card);
    setInterimCards(prev => [...prev, card]);
    setRefreshingCards(true);
    try {
      const r = await api.addChildCard(sessionId, card);
      setInterimCards(r.interim_cards);
      setChildRec(r.new_recommendation);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to add card');
      setInterimCards(prev => prev.filter(c => c.id !== card.id));
    } finally {
      setRefreshingCards(false);
    }
  }, [sessionId, role, setInterimCards]);

  const onSearchSelect = useCallback(async (word: string, category: string, image_url: string | null) => {
    if (!sessionId || role !== 'child') return;
    const optimistic: CardInfo = {
      id: `free-${Date.now()}`, recommendation_id: 'free',
      label: word, label_localized: word, category: category as any,
      corpus_name: word, corpus_image_url: image_url,
    };
    speakCard(optimistic);
    setInterimCards(prev => [...prev, optimistic]);
    setRefreshingCards(true);
    try {
      const r = await api.addFreeCard(sessionId, word, category, image_url);
      setInterimCards(r.interim_cards);
      setChildRec(r.new_recommendation);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to add card');
      setInterimCards(prev => prev.filter(c => c.id !== optimistic.id));
    } finally {
      setRefreshingCards(false);
    }
  }, [sessionId, role, setInterimCards]);

  // Tap-and-hold on a card: word forms (plural, past, -ing, ...) become a free card with the same picture.
  const [formCard, setFormCard] = useState<CardInfo | null>(null);
  const onCardHold = useCallback((card: CardInfo) => {
    if (role !== 'child' || card.is_folder) return;
    const v = engine.byId[card.id]; if (!v || formsFor(v.category).length === 0) return;
    setFormCard(card);
  }, [role]);
  const onPickForm = useCallback((card: CardInfo, form: WordForm) => {
    const word = inflect(card.corpus_name ?? card.label, form); setFormCard(null);
    if (word) onSearchSelect(word, card.category, card.corpus_image_url);
  }, [onSearchSelect]);

  const removeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const onRemoveCard = useCallback((cardId: string) => {
    removeQueueRef.current = removeQueueRef.current.then(async () => {
      if (!sessionId) return;
      const index = interimCardsRef.current.findIndex(c => c.id === cardId);
      if (index === -1) return;
      setInterimCards(prev => prev.filter((_, i) => i !== index));
      setRefreshingCards(true);
      try {
        const r = await api.removeCard(sessionId, index);
        setInterimCards(r.interim_cards);
        setChildRec(r.new_recommendation);
      } catch (e: any) {
        setErrorMsg(e?.message || 'Failed to remove card');
      } finally {
        setRefreshingCards(false);
      }
    });
  }, [sessionId, setInterimCards]);

  // Step 1: build the sentence from the selected cards, show the approval overlay
  const onConfirm = useCallback(async () => {
    if (!sessionId || interimCards.length === 0) return;
    setPhase('thinking');
    setPhaseLabel('Figuring out what you want to say…');
    try {
      const { sentence } = await api.inferSentence(sessionId);
      setInferredSentence(sentence);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to build sentence');
    } finally {
      setPhase('idle');
    }
  }, [sessionId, interimCards]);

  // "Another": a different wording for the same cards from the on-device realiser.
  const [anotherBusy, setAnotherBusy] = useState(false);
  const onAnotherSentence = useCallback(async () => {
    if (!sessionId || anotherBusy) return;
    setAnotherBusy(true);
    try { const { sentence } = await api.inferSentence(sessionId, true); setInferredSentence(sentence); }
    catch (e: any) { setErrorMsg(e?.message || 'Could not build another sentence'); }
    finally { setAnotherBusy(false); }
  }, [sessionId, anotherBusy]);

  // Step 2a: child approves → bank the sentence, stay on the child's turn with fresh cards
  const onAcceptSentence = useCallback(async () => {
    if (!sessionId) return;
    // Each tapped card is spoken; the whole sentence is spoken again once the child confirms it.
    if (inferredSentence) { setBankedChildSentences(prev => [...prev, inferredSentence]); speak(inferredSentence); }
    setInferredSentence(null);
    setPhase('thinking');
    setPhaseLabel('Getting your next cards…');
    try {
      const r = await api.confirmCards(sessionId);
      setChildRec(r.payload);
      setInterimCards([]);
      setHasBankedSentence(true);
      setPhase('idle');
      refreshDialogue();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to confirm');
      setPhase('idle');
    }
  }, [sessionId, refreshDialogue, inferredSentence, setInterimCards]);

  const onRejectSentence = useCallback(() => { setInferredSentence(null); }, []);

  // Done: hand the turn to the parent once the child is happy with everything said.
  const onFinishTurn = useCallback(async () => {
    if (!sessionId) return; // Done always works, even with nothing banked, so the turn can be handed back
    setInferredSentence(null);
    try {
      await api.finishChildTurn(sessionId);
      setRole('parent');
      setInterimCards([]);
      setChildRec(null);
      refreshDialogue();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to finish turn');
    }
  }, [sessionId, hasBankedSentence, refreshDialogue, setInterimCards]);

  const onClearCards = useCallback(async () => {
    if (!sessionId || refreshingCards) return;
    setRefreshingCards(true); setInterimCards([]);
    try { const r = await api.clearCards(sessionId); setInterimCards(r.interim_cards); setChildRec(r.new_recommendation); }
    catch (e: any) { setErrorMsg(e?.message || 'Failed to clear'); }
    finally { setRefreshingCards(false); }
  }, [sessionId, refreshingCards, setInterimCards]);
  const onRefreshCards = useCallback(async () => {
    if (!sessionId || refreshingCards) return;
    setRefreshingCards(true);
    try { setChildRec(await api.refreshCards(sessionId)); }
    catch (e: any) { setErrorMsg(e?.message || 'Failed to refresh'); }
    finally { setRefreshingCards(false); }
  }, [sessionId, refreshingCards]);

  // ----- End session -----
  async function endSession() {
    if (!sessionId) { nav('/home', { replace: true }); return; }
    stopSpeaking();
    setShowMenu(false);
    setPhase('closing');
    try { await api.endSession(sessionId); } catch {}
    nav(`/session-end/${encodeURIComponent(sessionId)}`, { replace: true });
  }

  // ----- Keyboard: Enter advances; Esc opens menu (or rejects sentence) -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (inferredSentence) {
        if (e.key === 'Enter') { e.preventDefault(); onAcceptSentence(); }
        if (e.key === 'Escape') { e.preventDefault(); onRejectSentence(); }
        return;
      }
      if (e.key === 'Escape') { setShowMenu(true); return; }
      if (phase !== 'idle') return;
      const inTextarea = (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (e.key === 'Enter' && (!inTextarea || e.metaKey || e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        if (role === 'parent') submitParent();
        else if (role === 'child' && interimCards.length > 0) onConfirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, role, submitParent, onConfirm, interimCards, inferredSentence, onAcceptSentence, onRejectSentence]);

  const overlays = (
    <>
        {inferredSentence && (
          <SentenceAcceptance sentence={inferredSentence} onAccept={onAcceptSentence} onReject={onRejectSentence} onAnother={onAnotherSentence} busy={anotherBusy} />
        )}

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
                    <TranscriptMessages
                      dialogue={dialogue}
                      msgClassName="ui-scale-transcript-msg"
                      roleClassName="ui-scale-transcript-role"
                      chipClassName="ui-scale-transcript-chip"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showMenu && (
          <SessionMenu onClose={() => setShowMenu(false)} onTranscript={() => setShowDialogue(true)} setting={setting} settings={SETTINGS} onSettingChange={changeSetting} onEnd={endSession} />
        )}

        {errorMsg && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#f09281] text-white px-5 py-3 rounded-xl shadow-xl text-sm font-bold flex items-center gap-3 max-w-md">
            {errorMsg}
            <button onClick={() => setErrorMsg(null)}><CloseIcon color="#fff" /></button>
          </div>
        )}

        {formCard && (

          <WordFormsPopover card={formCard} onPick={f => onPickForm(formCard, f)} onClose={() => setFormCard(null)} />

        )}

        {showSearch && (
          <CardSearchOverlay
            initialPath={scopedFolderPath} extraRows={moreRows}
            onSelect={onSearchSelect}
            onClose={() => { setShowSearch(false); setScopedFolderPath(undefined); }}
          />
        )}
    </>
  );

  if (compact) {
    return (
      <>
        <div ref={rootRef} className="fixed inset-0 -z-10" style={{ backgroundColor: '#f0ebe1' }} aria-hidden="true" />
        <CompactSession
          landscape={landscape}
          role={role} phase={phase} phaseLabel={phaseLabel} started={started}
          childRec={childRec} interim={interimCards}
          parentMessage={parentMessage} setParentMessage={setParentMessage} onSubmit={() => submitParent()} onAsk={(t) => submitParent(t)}
          isRecording={recState === 'recording'} partialTranscript={partialTranscript} onMicTap={handleMicTap}
          lastParentMessage={lastParentMessage} bankedChildSentences={bankedChildSentences}
          onCardClick={onCardClick} onCardHold={onCardHold} onRemoveCard={onRemoveCard} onRefresh={onRefreshCards} onClear={onClearCards} onConfirm={onConfirm}
          busy={refreshingCards} onSearchOpen={() => { setMoreRows(api.moreSuggestions()); setScopedFolderPath(undefined); setShowSearch(true); }} onMoreOpen={onMoreOpen}
          onDone={onFinishTurn} doneEnabled
          setting={setting} settings={SETTINGS} onSettingChange={changeSetting}
          onTranscript={() => setShowDialogue(true)} onEnd={endSession}
        />
        {overlays}
      </>
    );
  }

  return (
    <div ref={rootRef} className="fixed inset-0 overflow-hidden" style={{ backgroundColor: '#f0ebe1' }}>
      <div style={{ width: fit.cw, height: fit.ch, transform: `scale(${fit.s})`, transformOrigin: '0 0' }}>
      <div className="h-full overflow-hidden px-3 sm:px-4 pt-3 flex flex-col items-center relative safe-top">
        {/* Turn banner */}
        {/* Kept clear of the corner buttons (place picker left, menu right): at most the middle 60% of the width. */}
        <div className="mt-2 flex flex-row items-center justify-center gap-2 sm:gap-3 flex-wrap z-10 flex-shrink-0" style={{ maxWidth: '60%' }}>
          <TurnBanner role={role} parentText={lastParentMessage} childText={bankedChildSentences} />
        </div>

        {/* Center content */}
        <div className="flex-1 min-h-0 self-stretch flex flex-col items-stretch max-w-5xl w-full mx-auto mt-2 overflow-hidden">
          {(phase === 'init' || phase === 'thinking' || phase === 'closing') && (
            <div className="flex-1 flex items-center justify-center">
              <Loader label={phaseLabel} />
            </div>
          )}

          {phase === 'idle' && role === 'parent' && started && (
            <div className="flex-1 min-h-0 flex flex-col items-stretch">
              <ParentTurn
                setting={setting}
                onSettingChange={changeSetting}
                parentMessage={parentMessage}
                setParentMessage={setParentMessage}
                onSubmit={() => submitParent()}
                onAsk={(t) => submitParent(t)}
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
              onCardClick={onCardClick} onCardHold={onCardHold}
              onRemoveCard={onRemoveCard}
              onRefresh={onRefreshCards} onClear={onClearCards}
              onConfirm={onConfirm}
              busy={refreshingCards}
              onSearchOpen={() => { setMoreRows(api.moreSuggestions()); setScopedFolderPath(undefined); setShowSearch(true); }} onMoreOpen={onMoreOpen}
              onDone={onFinishTurn}
              doneEnabled
            />
          )}
        </div>

        {role === 'child' && phase === 'idle' && (
          <div className="fixed left-4 z-20" style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}>
            <SettingPicker value={setting} onChange={changeSetting} />
          </div>
        )}

        {/* Menu button */}
        <button
          onClick={() => setShowMenu(true)}
          className="icon-btn fixed right-4 z-20 p-3"
          style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
          title="Menu (Esc)"
          aria-label="Open session menu"
        >
          <MenuIcon size={28} />
        </button>

        {overlays}
      </div>
      </div>
    </div>
  );
}

function SettingPicker({ value, onChange, large = false }: { value: string; onChange: (v: string) => void; large?: boolean }) {
  const cur = SETTINGS.find(s => s.value === value) ?? SETTINGS[0];
  return (
    <label
      className={`flex items-center gap-3 rounded-2xl bg-white/90 backdrop-blur cursor-pointer ${large ? 'w-full h-16 pl-5 pr-4' : 'h-12 pl-3 pr-3'}`}
      style={{ boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: large ? 5 : 4 }}
    >
      <span className={`${large ? 'text-3xl' : 'text-lg'} leading-none`} aria-hidden="true">{cur.icon}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`bg-transparent font-bold text-slate-700 focus:outline-none cursor-pointer ${large ? 'flex-1 text-xl sm:text-2xl' : 'text-sm'}`}
        aria-label="Where are you talking?"
      >
        {SETTINGS.map(s => <option key={s.value} value={s.value}>{large ? s.label : s.label.split(' ')[0]}</option>)}
      </select>
    </label>
  );
}

function Loader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <Spinner size={112} />
      <p className="text-base font-bold text-slate-600">{label}</p>
    </div>
  );
}

interface ParentTurnProps {
  setting: string;
  onSettingChange: (v: string) => void;
  parentMessage: string;
  setParentMessage: (s: string) => void;
  onSubmit: () => void;
  onAsk: (text: string) => void;
  isRecording: boolean;
  partialTranscript: string;
  onMicTap: () => void;
}

function ParentTurn({ setting, onSettingChange, parentMessage, setParentMessage, onSubmit, onAsk, isRecording, partialTranscript, onMicTap }: ParentTurnProps) {
  return (
    <div className="w-full h-full flex flex-col mx-auto px-3 py-2 min-h-0">
      <AskPanel setting={setting} onSettingChange={onSettingChange} onAsk={onAsk}
        parentMessage={parentMessage} setParentMessage={setParentMessage} onSubmit={onSubmit}
        isRecording={isRecording} partialTranscript={partialTranscript} onMicTap={onMicTap} />
    </div>
  );
}

interface ChildTurnProps {
  rec: ChildCardRecommendationResult;
  interim: CardInfo[];
  onCardClick: (c: CardInfo) => void;
  onCardHold: (c: CardInfo) => void;
  onRemoveCard: (cardId: string) => void;
  onRefresh: () => void;
  onClear: () => void;
  onConfirm: () => void;
  busy: boolean;
  onSearchOpen: () => void;
  onMoreOpen: () => void;
  onDone: () => void;
  doneEnabled: boolean;
}

function ChildTurn({ rec, interim, onCardClick, onCardHold, onRemoveCard, onRefresh, onClear, onConfirm, busy, onSearchOpen, onMoreOpen, onDone, doneEnabled }: ChildTurnProps) {
  const byCat = useMemo(() => {
    const groups: Record<CardInfo['category'], CardInfo[]> = { topic: [], action: [], emotion: [], core: [] };
    for (const c of rec.cards) (groups[c.category] ||= []).push(c);
    return groups;
  }, [rec]);

  // Topic 4 columns, Action 1, Feeling 1 -- three rows each: 12 / 3 / 3 (see PANEL in api/local.ts).
  const mainCats: Array<{ key: 'topic' | 'action' | 'emotion'; label: string; tint: string; cols: string; span: string }> = [
    { key: 'topic',   label: 'Topic',   tint: 'bg-card-topic/40',   cols: 'grid-cols-4', span: 'col-span-4' },
    { key: 'action',  label: 'Action',  tint: 'bg-card-action/40',  cols: 'grid-cols-1', span: 'col-span-1' },
    { key: 'emotion', label: 'Feeling', tint: 'bg-card-emotion/40', cols: 'grid-cols-1', span: 'col-span-1' },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col items-stretch gap-2">

      {/* Selected-card deck -- fixed height, horizontal scroll, text pills */}
      <div
        className="flex-shrink-0 h-[84px] bg-amber-50/80 rounded-2xl px-3 py-2 shadow-sm flex items-center gap-3"
        style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
      >
       <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
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
                onClick={() => onRemoveCard(c.id)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border-2 border-b-4 border-black rounded-full text-sm font-bold text-slate-700 active:scale-95 transition-transform"
                style={{ touchAction: 'manipulation' }}
              >
                {c.corpus_name ?? c.label}
                <span className="text-[#f09281] text-[11px] font-extrabold">✕</span>
              </button>
            ))}
          </div>
        )}
       </div>
        {/* Say it: right where the chosen words are, not down in the action bar */}
        <button
          onClick={onConfirm}
          disabled={interim.length === 0 || busy}
          className="pill-btn bg-[#94c1c2] disabled:opacity-40 text-sm sm:text-base px-5 sm:px-8 py-2.5 shadow-lg shrink-0"
          title="Turn the chosen cards into a sentence"
        >Speak</button>
      </div>

      {/* Main: 3 category panels side-by-side, widths 3 : 2 : 1 */}
      <div className="relative flex-shrink-0">
        {busy && (
          <div className="absolute inset-0 z-10 bg-white/70 backdrop-blur-[1px] rounded-2xl flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow border">
              <Spinner size={20} strokeWidth={6} />
              <span className="text-sm font-bold text-slate-600">Thinking…</span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-6 gap-2 sm:gap-3">
          {mainCats.map(({ key, label, tint, cols, span }) => (
            <div
              key={key}
              className={`${tint} ${span} rounded-2xl p-2 sm:p-3 flex flex-col`}
              style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
            >
              <p className="text-center text-sm sm:text-base font-extrabold text-slate-700 mb-2 flex-shrink-0">{label}</p>
              <div className={`grid ${cols} gap-2 sm:gap-3 content-start justify-items-center`}>
                {byCat[key].map(c => (
                  <CardChip key={c.id} card={c} size="lg" onClick={() => !busy && onCardClick(c)} onLongPress={() => !busy && onCardHold(c)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom: the quick row -- Yes / No / Please, five personal cards, the child's name card -- then More ideas and View all, one row */}
      <div className="flex-shrink-0 flex justify-start sm:justify-center gap-2 sm:gap-3 flex-nowrap overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        {byCat.core.map(c => (
          <div key={c.id} className="shrink-0">
            <CardChip card={c} size={byCat.core.length > 6 ? 'sm' : 'md'} onClick={() => !busy && onCardClick(c)} />   // 3 fixed + 5 personal (+ name) must fit one row
          </div>
        ))}
        <div className="shrink-0">
          <button
            onClick={onMoreOpen}
            style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
            className="w-[72px] h-24 sm:w-24 sm:h-28 flex flex-col items-center justify-between rounded-2xl bg-white border-2 border-b-4 border-black hover:shadow-md active:scale-95 transition-all duration-150 p-2 pt-1.5 pb-1.5 select-none"
          >
            <div className="flex-1 w-full rounded-xl flex items-center justify-center bg-amber-50">
              <span className="text-3xl leading-none" role="img" aria-label="More ideas">💡</span>
            </div>
            <div className="w-full mt-1.5 px-0.5 text-center leading-tight">
              <div className="text-xs sm:text-sm font-bold text-slate-500 line-clamp-2">More ideas</div>
            </div>
          </button>
        </div>
        <div className="shrink-0">
          <button
            onClick={onSearchOpen}
            style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
            className="w-[72px] h-24 sm:w-24 sm:h-28 flex flex-col items-center justify-between rounded-2xl bg-white border-2 border-b-4 border-black hover:shadow-md active:scale-95 transition-all duration-150 p-2 pt-1.5 pb-1.5 select-none cursor-pointer"
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
          onClick={onClear}
          disabled={busy || interim.length === 0}
          className="pill-btn bg-white text-slate-600 border-2 border-slate-400 disabled:opacity-40 text-sm sm:text-base px-4 sm:px-6 py-2 sm:py-3"
        >✕ Clear</button>
        <button
          onClick={onDone}
          disabled={busy}
          className="pill-btn bg-[#f09281] disabled:opacity-40 text-base px-8 sm:px-10 py-3 shadow-lg"
        >Done</button>
      </div>
    </div>
  );
}

function SentenceAcceptance({ sentence, onAccept, onReject, onAnother, busy }: { sentence: string; onAccept: () => void; onReject: () => void; onAnother: () => void; busy: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-6">
      <div
        className="w-full max-w-2xl rounded-[2rem] sm:rounded-[2.5rem] flex flex-col items-center gap-4 sm:gap-8 px-5 py-6 sm:px-8 sm:py-12 shadow-2xl overflow-y-auto"
        style={{ background: '#f0ebe1', boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8, maxHeight: '90dvh' }}
      >
        <h2 className="text-2xl sm:text-5xl font-extrabold text-slate-700">You said</h2>

        <div className="w-full max-w-xl rounded-3xl p-4 sm:p-8 bg-[#94c1c2]/10 overflow-y-auto" style={{ maxHeight: '40vh', opacity: busy ? 0.5 : 1 }}>
          <p className="text-xl sm:text-4xl font-bold text-slate-700 text-center leading-snug">{sentence}</p>
        </div>

        {/* "Another": a different wording from the on-device realiser. "Yes" speaks whichever one is showing. */}
        <button
          onClick={onAnother}
          disabled={busy}
          className="flex flex-col items-center gap-3 active:scale-95 motion-reduce:active:scale-100 transition-transform duration-300 ease-in-out disabled:opacity-60"
          aria-label="Try another sentence"
        >
          <div
            className="w-16 h-16 sm:w-28 sm:h-28 rounded-full flex items-center justify-center transition-colors duration-300 ease-in-out"
            style={{ background: busy ? '#f4a998' : '#f09281', boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 7 }}
          >
            <span className={`text-4xl sm:text-6xl text-white ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`}>↻</span>
          </div>
          <span className="text-xl font-bold text-slate-500 select-none">{busy ? 'Thinking…' : 'Another'}</span>
        </button>

        <div className="flex gap-4 w-full max-w-xl">
          <button
            onClick={onReject}
            className="flex-1 py-3 sm:py-6 rounded-3xl text-xl sm:text-3xl font-extrabold text-black active:brightness-95 transition-colors duration-300 ease-in-out"
            style={{ background: '#f09281', boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 6 }}
          >No</button>
          <button
            onClick={onAccept}
            disabled={busy}
            className="flex-1 py-3 sm:py-6 rounded-3xl text-xl sm:text-3xl font-extrabold text-black active:brightness-95 transition-colors duration-300 ease-in-out disabled:opacity-60"
            style={{ background: '#94c1c2', boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: 6 }}
          >Yes</button>
        </div>
      </div>
    </div>
  );
}


/** Word forms for a held card: one button per form, showing the word it will add. */
function WordFormsPopover({ card, onPick, onClose }: { card: CardInfo; onPick: (f: WordForm) => void; onClose: () => void }) {
  const base = card.corpus_name ?? card.label; const v = engine.byId[card.id];
  const forms = (v ? formsFor(v.category) : []).map(f => [f, inflect(base, f)] as const).filter(([, w]) => !!w);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-3xl p-5 shadow-2xl flex flex-col gap-3 min-w-[280px]" style={{ border: '3px solid #000', borderBottomWidth: 7 }} onClick={e => e.stopPropagation()}>
        <p className="text-center font-extrabold text-slate-700 text-lg">{base}</p>
        {forms.map(([f, w]) => (
          <button key={f} onClick={() => onPick(f)} className="flex items-center justify-between gap-4 px-4 py-3 rounded-2xl bg-[#fdf1cf] active:scale-95 transition-transform" style={{ border: '2px solid #000', borderBottomWidth: 4 }}>
            <span className="text-sm font-bold text-slate-500">{FORM_LABELS[f]}</span>
            <span className="text-xl font-extrabold text-slate-800">{w}</span>
          </button>
        ))}
        <button onClick={onClose} className="pill-btn bg-slate-300 text-sm py-2 mt-1">Cancel</button>
      </div>
    </div>
  );
}
