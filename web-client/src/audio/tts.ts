// Browser Web Speech API wrapper for speaking card labels and example utterances.

let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  if (voice) return voice;
  const all = window.speechSynthesis.getVoices();
  // Prefer en-US Google or default English voices.
  voice =
    all.find(v => /en-US/i.test(v.lang) && /google/i.test(v.name)) ||
    all.find(v => /en-US/i.test(v.lang)) ||
    all.find(v => /^en/i.test(v.lang)) ||
    all[0] ||
    null;
  return voice;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  // Voices are loaded asynchronously on some browsers.
  window.speechSynthesis.onvoiceschanged = () => { voice = null; pickVoice(); };
  pickVoice();
}

export function speak(text: string, opts: { rate?: number; pitch?: number } = {}) {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = opts.rate ?? 0.95;
  u.pitch = opts.pitch ?? 1.0;
  synth.speak(u);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// Prefer the matched corpus card name over the raw LLM label so TTS pronounces
// the actual word the child sees on the card.
export function speakCard(card: { label: string; corpus_name?: string | null }) {
  speak(card.corpus_name || card.label);
}
