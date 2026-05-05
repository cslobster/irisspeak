// Tracks an in-progress mic recording with live RMS metering.
// Exposes start/stop/pause/resume and a meter callback so callers can render a level indicator.

export type RecorderState = 'idle' | 'recording' | 'paused';

export class MicRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private startedAt = 0;
  private state: RecorderState = 'idle';

  onMeter: (rms: number) => void = () => {};
  onState: (s: RecorderState) => void = () => {};

  getState(): RecorderState { return this.state; }
  getElapsedMs(): number { return this.state === 'idle' ? 0 : Date.now() - this.startedAt; }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    const rec = new MediaRecorder(stream);
    this.chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    rec.start(250);
    this.rec = rec;
    this.startedAt = Date.now();
    this.state = 'recording';
    this.onState(this.state);
    this.startMetering(stream);
  }

  pause() {
    if (this.state !== 'recording' || !this.rec) return;
    this.rec.pause();
    this.state = 'paused';
    this.onState(this.state);
  }

  resume() {
    if (this.state !== 'paused' || !this.rec) return;
    this.rec.resume();
    this.state = 'recording';
    this.onState(this.state);
  }

  /** Stops recording and resolves the recorded blob (or null if discarded). */
  async stop(discard = false): Promise<Blob | null> {
    if (!this.rec) { this.cleanup(); return null; }
    return new Promise<Blob | null>((resolve) => {
      const rec = this.rec!;
      rec.onstop = () => {
        const blob = discard ? null : new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
        this.cleanup();
        this.onState(this.state);
        resolve(blob);
      };
      rec.stop();
    });
  }

  private cleanup() {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
    this.analyser = null;
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.rec = null;
    this.chunks = [];
    this.state = 'idle';
  }

  private startMetering(stream: MediaStream) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.audioCtx = ctx;
      this.analyser = analyser;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        this.onMeter(rms);
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    } catch {}
  }
}
