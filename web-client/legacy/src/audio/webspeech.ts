// Web Speech API recognizer — uses the browser's built-in speech recognition.
// On iOS Safari this routes through Apple's native dictation; on Chrome/Edge it
// uses Google's online recognizer. Either way: no model download, no ONNX, no WASM.

type SR = any;

export function isWebSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export type RecognizerState = 'idle' | 'listening' | 'stopping';

export class WebSpeechRecognizer {
  private rec: SR | null = null;
  private state: RecognizerState = 'idle';
  private finalText = '';
  private interimText = '';   // persisted across onresult calls so onend can save it
  private resolveStop: ((text: string) => void) | null = null;

  onState: (s: RecognizerState) => void = () => {};
  onPartial: (text: string) => void = () => {};

  getState(): RecognizerState { return this.state; }

  /** Start listening. Returns a Promise that resolves with the final transcript when stop() is called. */
  start(opts: { lang?: string } = {}): Promise<string> {
    if (this.state !== 'idle') return Promise.resolve('');
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return Promise.reject(new Error('Web Speech API not supported'));

    this.finalText = '';
    this.interimText = '';
    this.state = 'listening';
    this.onState(this.state);

    return new Promise<string>((resolve, reject) => {
      this.resolveStop = resolve;

      // iOS Safari doesn't honour continuous=true — it fires onend after each
      // pause. We work around this by restarting the recognizer transparently
      // whenever onend fires while we're still in 'listening' state.
      const startSession = () => {
        // stop() may have been called during the restart gap — bail out and let
        // stop()'s immediate-resolve path handle it.
        if (this.state !== 'listening') return;

        const r = new SR();
        r.lang = opts.lang ?? 'en-US';
        r.continuous = true;
        r.interimResults = true;

        r.onresult = (e: any) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const piece = e.results[i][0]?.transcript ?? '';
            if (e.results[i].isFinal) {
              this.finalText += piece + ' ';
            } else {
              interim += piece;
            }
          }
          // Keep interimText current so onend can recover it if iOS stops
          // the session before marking those words as final.
          this.interimText = interim;
          this.onPartial((this.finalText + interim).trim());
        };

        r.onerror = (e: any) => {
          // 'no-speech' and 'aborted' are benign on iOS — onend will follow.
          if (e.error === 'no-speech' || e.error === 'aborted') return;
          this.cleanup();
          reject(new Error(`speech-recognition: ${e.error || 'unknown'}`));
        };

        r.onend = () => {
          // iOS sometimes stops the session before the last phrase is marked
          // isFinal. Save any interim words now so they aren't lost.
          if (this.interimText) {
            this.finalText += this.interimText + ' ';
            this.interimText = '';
          }

          if (this.state === 'listening') {
            // iOS auto-stopped us. Null rec NOW so stop() can detect the gap,
            // then restart after a brief pause.
            this.rec = null;
            setTimeout(startSession, 50);
            return;
          }

          // Explicit stop() was called — resolve with everything accumulated.
          const text = this.finalText.trim();
          this.cleanup();
          const cb = this.resolveStop;
          this.resolveStop = null;
          if (cb) cb(text); else resolve(text);
        };

        this.rec = r;
        try { r.start(); } catch (err) { this.cleanup(); reject(err); }
      };

      startSession();
    });
  }

  /** Stop listening. The Promise returned by start() will resolve with the final transcript. */
  stop(): void {
    if (this.state !== 'listening') return;
    this.state = 'stopping';
    this.onState(this.state);

    if (this.rec) {
      // Normal path: ask the active recognizer to stop; onend will resolve.
      try { this.rec.stop(); } catch {}
    } else {
      // We're in the 150ms restart gap — rec is null. startSession() will see
      // state !== 'listening' and bail, so we must resolve here immediately.
      const text = (this.finalText + this.interimText).trim();
      this.cleanup();
      const cb = this.resolveStop;
      this.resolveStop = null;
      if (cb) cb(text);
    }
  }

  abort(): void {
    // Null resolveStop first so any in-flight onend callback doesn't resolve.
    this.resolveStop = null;
    if (this.rec) {
      try { this.rec.abort(); } catch {}
    }
    this.cleanup();
  }

  private cleanup() {
    this.rec = null;
    this.interimText = '';
    this.state = 'idle';
    this.onState(this.state);
  }
}
