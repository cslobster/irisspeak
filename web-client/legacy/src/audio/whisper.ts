// Browser-side speech-to-text via @huggingface/transformers (Whisper) on WebGPU,
// with a WASM fallback. Lazy-loads the model on first call.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

// whisper-tiny.en: ~40MB q8, English-only, plenty for parent dictation.
const MODEL_ID = 'onnx-community/whisper-tiny.en';
const TARGET_SR = 16000;

let _ready: Promise<any> | null = null;
let _device: 'webgpu' | 'wasm' = 'wasm';
let _progressCb: ((p: ProgressEvent) => void) | null = null;

export interface ProgressEvent {
  status: string;          // 'progress' | 'done' | 'ready' | 'initiate' | 'download'
  file?: string;
  progress?: number;       // 0–100
  loaded?: number;
  total?: number;
}

function detectWebGPU(): boolean {
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) return false;
  // iOS Safari (and any WebKit on Apple touch devices) has a half-baked WebGPU implementation
  // that crashes onnxruntime with "qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing
  // required scale" on Whisper. Force-WASM there regardless of what navigator.gpu reports.
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  const isSafariWebKit = /^((?!chrome|android).)*safari/i.test(ua);
  if (isIOS || isSafariWebKit) return false;
  return true;
}

export function whisperDevice(): 'webgpu' | 'wasm' { return _device; }

export function setProgressCallback(cb: ((p: ProgressEvent) => void) | null) {
  _progressCb = cb;
}

// Dtype menu for fallback. The error
//   `qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale`
// happens because the *_quantized.onnx (q8) variant of whisper-tiny.en's decoder
// uses MatMulNBits (4-bit block-quantized matmul) internally, and iOS Safari's
// onnxruntime-web doesn't ship the kernel that provides the required scale tensors.
// `int8` uses standard QDQ ops which iOS handles, and `fp32` is unconditionally safe.
const WASM_DTYPE_FALLBACKS: Array<Record<string, string>> = [
  { encoder_model: 'fp32', decoder_model_merged: 'int8' },
  { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
];
const GPU_DTYPE: Record<string, string> = { encoder_model: 'fp32', decoder_model_merged: 'q8' };

async function tryLoad(device: 'webgpu' | 'wasm', dtype: any): Promise<any> {
  return pipeline('automatic-speech-recognition', MODEL_ID, {
    device,
    dtype,
    progress_callback: (p: any) => { _progressCb?.(p); },
  } as any);
}

async function loadPipeline() {
  if (_ready) return _ready;
  const wantWebGPU = detectWebGPU();
  _device = wantWebGPU ? 'webgpu' : 'wasm';
  _ready = (async () => {
    if (wantWebGPU) {
      try {
        return await tryLoad('webgpu', GPU_DTYPE);
      } catch (err) {
        console.warn('[whisper] WebGPU pipeline failed, falling back to wasm:', err);
        _device = 'wasm';
      }
    }
    let lastErr: any = null;
    for (const dtype of WASM_DTYPE_FALLBACKS) {
      try {
        return await tryLoad('wasm', dtype);
      } catch (err) {
        lastErr = err;
        console.warn(`[whisper] wasm load failed for dtype ${JSON.stringify(dtype)}, trying next:`, err);
      }
    }
    throw lastErr || new Error('All whisper dtype variants failed to load');
  })().catch((err) => {
    _ready = null;
    throw err;
  });
  return _ready;
}

export async function preloadWhisper(): Promise<void> { await loadPipeline(); }

/** Decode a recorded Blob (webm/ogg/whatever the MediaRecorder produced) to mono 16 kHz Float32. */
export async function blobToFloat32Mono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AudioCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
  } finally {
    try { ctx.close(); } catch {}
  }
  const channelCount = decoded.numberOfChannels;
  const len = decoded.length;
  const mono = new Float32Array(len);
  if (channelCount === 1) {
    mono.set(decoded.getChannelData(0));
  } else {
    const ch0 = decoded.getChannelData(0);
    const ch1 = decoded.getChannelData(1);
    for (let i = 0; i < len; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
  }
  if (decoded.sampleRate === TARGET_SR) return mono;
  // Linear-resample to 16 kHz.
  const ratio = decoded.sampleRate / TARGET_SR;
  const outLen = Math.floor(len / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, len - 1);
    const t = idx - i0;
    out[i] = mono[i0] * (1 - t) + mono[i1] * t;
  }
  return out;
}

/** Run Whisper on a 16 kHz mono Float32 buffer. Returns trimmed transcript string. */
export async function transcribe(audio: Float32Array): Promise<string> {
  const asr = await loadPipeline();
  // whisper-tiny.en is English-only; passing language/task would error.
  const out: any = await asr(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false,
  });
  const text = (Array.isArray(out) ? out[0]?.text : out?.text) || '';
  return String(text).trim();
}

/** Convenience: blob → text. */
export async function transcribeBlob(blob: Blob): Promise<string> {
  const audio = await blobToFloat32Mono16k(blob);
  return transcribe(audio);
}
