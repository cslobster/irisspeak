// Browser Web Speech API wrapper for speaking card labels and example utterances.
// Two voices: "girl" and "boy". The default follows the child's gender on the account (profile.gender); Settings can
// override it. Browsers ship different voice sets, so the pick is by voice gender hints in the name, with a pitch
// lift so the boy voice sounds young rather than like a grown man.
import { getMuted } from './mute';
import { getProfile } from '../engine/store';
import { store } from '../engine/store';

export type VoiceChoice = 'auto' | 'girl' | 'boy';
export function getVoiceChoice(): VoiceChoice { return store.get<VoiceChoice>('voice', 'auto'); }
export function setVoiceChoice(v: VoiceChoice) { store.set('voice', v); voice = null; }
/** The voice actually in use: the setting, else the child's gender, else girl. */
export function effectiveVoice(): 'girl' | 'boy' { const c = getVoiceChoice(); if (c !== 'auto') return c; return getProfile().gender === 'boy' ? 'boy' : 'girl'; }

const MALE = /\b(male|aaron|alex|daniel|fred|evan|nathan|tom|oliver|arthur|james|rishi|david|mark|guy|ryan|eddy|reed|rocko)\b/i;
const FEMALE = /\b(female|samantha|ava|allison|nicky|zoe|susan|karen|moira|tessa|fiona|kate|serena|victoria|zira|jenny|aria|flo|sandy|shelley)\b/i;
let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  if (voice) return voice;
  const all = window.speechSynthesis.getVoices();
  const en = all.filter(v => /^en/i.test(v.lang)); const us = en.filter(v => /en-US/i.test(v.lang));
  const want = effectiveVoice();
  const gendered = (list: SpeechSynthesisVoice[]) => list.find(v => want === 'boy' ? MALE.test(v.name) && !FEMALE.test(v.name) : FEMALE.test(v.name) && !MALE.test(v.name));
  voice = (want === 'boy' ? en.find(v => /^junior$/i.test(v.name)) : null)   // Apple's "Junior": a real young-boy voice (Safari / macOS)
    || gendered(us) || gendered(en)
    || (want === 'boy' ? (us.find(v => /male/i.test(v.name)) || en.find(v => /male/i.test(v.name))) : null)
    || us.find(v => /google/i.test(v.name) && !/male/i.test(v.name)) || us[0] || en[0] || all[0] || null;
  return voice;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  // Voices are loaded asynchronously on some browsers.
  window.speechSynthesis.onvoiceschanged = () => { voice = null; pickVoice(); };
  pickVoice();
}

export function speak(text: string, opts: { rate?: number; pitch?: number } = {}) {
  if (!('speechSynthesis' in window) || getMuted()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  const boy = effectiveVoice() === 'boy';
  u.rate = opts.rate ?? 0.95;
  u.pitch = opts.pitch ?? (boy ? (/^junior$/i.test(v?.name || '') ? 1.0 : 1.3) : 1.05);   // Junior already sounds young; a male voice needs the lift
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
