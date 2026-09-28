import { useRef, useState } from 'react';
import { addVocabularyWord, isSignedIn, syncCustomWords } from '../api/remote';
import { getCustomWords, setCustomWords } from '../engine/store';
import { squareJpegBase64 } from '../imageSquare';

/** "Add a card" from the My cards page: a word, a picture, and whether it is a thing or something you do.
 *  Signed in, it is saved to the shared account (dyad_custom_word) and so reaches every device; as a guest it is
 *  kept on this device only. Removing a card is in Settings > Vocabulary, away from the child's board. */
export function AddCardDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [word, setWord] = useState('');
  const [category, setCategory] = useState<'topic' | 'action'>('topic');
  const [image, setImage] = useState<string | null>(null);   // bare base64 JPEG
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setError(null);
    try { setImage(await squareJpegBase64(f)); } catch { setError('That file is not a picture.'); }
  }
  async function save() {
    const w = word.trim(); if (!w) return;
    if (getCustomWords().some(c => c.word.toLowerCase() === w.toLowerCase())) { setError(`"${w}" is already one of your cards.`); return; }
    setSaving(true); setError(null);
    try {
      if (isSignedIn()) {
        await addVocabularyWord({ word: w, category, image_data: image, emoji: null });
        await syncCustomWords();
      } else {
        setCustomWords([...getCustomWords(), { word: w, category, image_url: image ? `data:image/jpeg;base64,${image}` : null, emoji: null, favourite: false }]);
      }
      onAdded(); onClose();
    } catch { setError('Could not save the card. Check the connection and try again.'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl border-2 border-b-4 border-black bg-[#f0ebe1] p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-extrabold text-slate-800 text-center">Add a card</h2>

        <button onClick={() => fileRef.current?.click()} aria-label="Choose a picture"
          className="mx-auto w-32 h-32 rounded-2xl border-2 border-b-4 border-black bg-white flex flex-col items-center justify-center overflow-hidden active:scale-95">
          {image ? <img src={`data:image/jpeg;base64,${image}`} alt="" className="w-full h-full object-cover" />
            : <><span className="text-4xl" aria-hidden="true">📷</span><span className="text-xs font-bold text-slate-500 mt-1">Add a picture</span></>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />

        <input value={word} onChange={e => setWord(e.target.value)} placeholder="Word (e.g. Buddy, grandma's house)" autoFocus
          className="w-full rounded-xl border-2 border-slate-300 px-3 py-2.5 text-base bg-white" maxLength={40} />

        <div className="grid grid-cols-2 gap-2">
          {(['topic', 'action'] as const).map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`rounded-xl border-2 py-2 text-sm font-bold ${category === c ? 'border-black bg-white text-slate-800' : 'border-slate-300 text-slate-500'}`}>
              {c === 'topic' ? 'A thing' : 'Something you do'}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-[#d9604a] font-semibold text-center">{error}</p>}
        {!isSignedIn() && <p className="text-xs text-slate-500 text-center">Not signed in: this card is kept on this device only.</p>}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose} className="rounded-xl border-2 border-b-4 border-black bg-white py-2.5 font-bold text-slate-700">Cancel</button>
          <button onClick={save} disabled={saving || !word.trim()}
            className="rounded-xl border-2 border-b-4 border-black py-2.5 font-bold text-slate-800 disabled:opacity-40" style={{ background: '#94c1c2' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
