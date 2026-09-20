import { remoteFeedback } from '../api/remote';
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/local';
import { engine, QUESTION_CARD_ID } from '../engine/model';
import { getProfile, setProfile } from '../engine/store';
import { TurnBanner } from '../components/TurnBanner';
import { TranscriptMessages } from '../components/Transcript';
import { CloseIcon, MenuIcon, MicIcon } from '../components/Icons';
import { CardSearchOverlay } from '../components/CardSearchOverlay';
import { CompactSession } from './CompactSession';
import { SessionMenu } from '../components/SessionMenu';
import { formsFor, inflect, type WordForm } from '../engine/grammar';
import { SETTINGS } from '../engine/settings';
import { speak, speakCard, stopSpeaking } from '../audio/tts';
import { WebSpeechRecognizer, isWebSpeechSupported } from '../audio/webspeech';
import type { CardInfo, ChildCardRecommendationResult, DialogueRole, DialogueMessage } from '../api/types';
// The session screen was one 970-line file; it is now a shell (state + handlers + composition) over these modules,
// so the layout maths, the two turns and the modal overlays can be edited independently.
import { CONTENT_W, ACTION_COL_W, SIDE_DESIGN_H, DESIGN_H, useShortLandscape, useFitScale } from './session/layout';
import { ParentTurn, SettingPicker, Loader } from './session/ParentTurn';
import { ChildTurn } from './session/ChildTurn';
import { FeedbackDialog, SentenceAcceptance, WordFormsPopover } from './session/overlays';

type Phase = 'init' | 'idle' | 'thinking' | 'closing';

export function SessionScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const nav = useNavigate();

  const [phase, setPhase] = useState<Phase>('init');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
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
  const sideActions = useShortLandscape();
  const fit = useFitScale(rootRef, CONTENT_W + 32 + (sideActions ? ACTION_COL_W + 12 : 0), sideActions ? SIDE_DESIGN_H : DESIGN_H);
  // the content wrapper's on-screen box (after scaling); the top controls are pinned to it so every row shares one width
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentBox, setContentBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = contentRef.current; if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); setContentBox(b => (b && Math.abs(b.left - r.left) < 0.5 && Math.abs(b.width - r.width) < 0.5) ? b : { left: r.left, width: r.width }); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [fit.s, fit.cw]);
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
    if (card.id !== QUESTION_CARD_ID) speakCard(card);
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
      {feedbackOpen && (() => { const ctx = api.feedbackContext; return (
        <FeedbackDialog setting={getProfile().setting || 'unknown'} question={ctx?.question || ''} candidates={ctx?.candidates || []}
          onClose={() => setFeedbackOpen(false)}
          onSend={(choice, answer, disliked) => remoteFeedback({ session_id: ctx?.session_id, setting: getProfile().setting || 'unknown', question: ctx?.question || '',
            candidates: ctx?.candidates || [], prefix: ctx?.prefix || [], choice, disliked: choice === 'dislike' ? disliked : undefined, answer: choice === 'own_answer' ? answer : undefined,
            model_version: engine.modelVersion, timestamp: Date.now() })} />); })()}
      <div style={{ width: fit.cw, height: fit.ch, transform: `scale(${fit.s})`, transformOrigin: '0 0' }}>
      <div className="h-full overflow-hidden px-3 sm:px-4 pt-3 flex flex-col items-center relative safe-top">
        {/* Turn banner */}
        {/* Kept clear of the corner buttons (place picker left, menu right): at most the middle 60% of the width. */}
        <div className="mt-2 flex flex-row items-center justify-center gap-2 sm:gap-3 flex-wrap z-10 flex-shrink-0" style={{ maxWidth: '60%' }}>
          <TurnBanner role={role} parentText={lastParentMessage} childText={bankedChildSentences} />
        </div>

        {/* Center content */}
        <div ref={contentRef} className="flex-1 min-h-0 self-stretch flex flex-col items-stretch w-full mx-auto mt-2 overflow-hidden" style={{ maxWidth: CONTENT_W + (sideActions ? ACTION_COL_W + 12 : 0) }}>
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
            <ChildTurn onFeedback={() => setFeedbackOpen(true)} sideActions={sideActions}
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

        {/* The place picker (child's turn) lines up with the board's left edge; the menu button stays in the page's
            top-right corner on every screen, clear of the parent's setting tiles. */}
        {role === 'child' && phase === 'idle' && (
          <div className="fixed z-20" style={{ top: 'max(0.75rem, env(safe-area-inset-top))', left: contentBox ? contentBox.left : 16 }}>
            <SettingPicker value={setting} onChange={changeSetting} />
          </div>
        )}
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
