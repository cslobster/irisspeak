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
  private resolveStop: ((text: string) => void) | null = null;

  onState: (s: RecognizerState) => void = () => {};
  onPartial: (text: string) => void = () => {};

  getState(): RecognizerState { return this.state; }

  /** Start listening. Returns a Promise that resolves with the final transcript when stop() is called. */
  start(opts: { lang?: string } = {}): Promise<string> {
    if (this.state !== 'idle') return Promise.resolve('');
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return Promise.reject(new Error('Web Speech API not supported'));

    const r = new SR();
    r.lang = opts.lang ?? 'en-US';
    r.continuous = true;        // keep listening across pauses until we stop()
    r.interimResults = true;    // surface partial transcripts as the user speaks

    this.finalText = '';
    return new Promise<string>((resolve, reject) => {
      this.resolveStop = resolve;

      r.onresult = (e: any) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const piece = e.results[i][0]?.transcript ?? '';
          if (e.results[i].isFinal) this.finalText += piece + ' ';
          else interim += piece;
        }
        this.onPartial((this.finalText + interim).trim());
      };

      r.onerror = (e: any) => {
        // 'no-speech' & 'aborted' are benign; treat as empty result rather than error.
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        this.cleanup();
        reject(new Error(`speech-recognition: ${e.error || 'unknown'}`));
      };

      r.onend = () => {
        const text = this.finalText.trim();
        this.cleanup();
        const r = this.resolveStop;
        this.resolveStop = null;
        if (r) r(text); else resolve(text);
      };

      this.rec = r;
      this.state = 'listening';
      this.onState(this.state);
      try { r.start(); } catch (err) { this.cleanup(); reject(err); }
    });
  }

  /** Stop listening. The Promise returned by start() will resolve with the final transcript. */
  stop(): void {
    if (this.state !== 'listening' || !this.rec) return;
    this.state = 'stopping';
    this.onState(this.state);
    try { this.rec.stop(); } catch {}
  }

  abort(): void {
    if (!this.rec) return;
    try { this.rec.abort(); } catch {}
    this.cleanup();
  }

  private cleanup() {
    this.rec = null;
    this.state = 'idle';
    this.onState(this.state);
  }
}
