import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { CloseIcon } from '../components/Icons';
import type { CustomVocabularyWord } from '../api/types';

// Parent-direct Custom Vocabulary Word only (see CONTEXT.md) — every word added here is
// auto-approved immediately, since deliberate parent input carries no invention risk. This
// screen doesn't yet support marking an existing corpus word as a preference pointer (e.g.
// "favorite color: red") — that needs a search-the-corpus UI this pass didn't build; every word
// added here is treated as a genuinely new word.
export function VocabularySettingsScreen() {
  const nav = useNavigate();
  const [words, setWords] = useState<CustomVocabularyWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [word, setWord] = useState('');
  const [category, setCategory] = useState<'topic' | 'action'>('topic');
  const [emoji, setEmoji] = useState('');
  const [imageData, setImageData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.listVocabulary().then(setWords).catch(() => setError('Could not load vocabulary.')).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setImageData(null); return; }
    const reader = new FileReader();
    reader.onload = () => {
      // Strip the "data:image/...;base64," prefix — backend stores just the base64 payload
      // and reconstructs the data URI itself (see corpus.ts's lookupDyadWord).
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      setImageData(base64);
    };
    reader.readAsDataURL(file);
  }

  async function addWord() {
    if (!word.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.addVocabularyWord({
        word: word.trim(),
        category,
        image_data: imageData,
        emoji: imageData ? null : (emoji.trim() || null),
      });
      setWord(''); setEmoji(''); setImageData(null);
      load();
    } catch {
      setError('Could not add word.');
    } finally {
      setSaving(false);
    }
  }

  async function removeWord(id: string) {
    setWords((prev) => prev.filter((w) => w.id !== id));
    try { await api.deleteVocabularyWord(id); } catch { load(); }
  }

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#f0ebe1' }}>
      <div className="min-h-screen px-8 py-8 max-w-2xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-extrabold text-black">Vocabulary</h2>
          <button onClick={() => nav(-1)} className="rounded-xl p-2 bg-white border-2 border-b-4 border-black"><CloseIcon /></button>
        </header>

        <p className="text-sm text-slate-500 mb-4">
          Add words that aren't in the app yet — like a friend's name, pet, or school — so your child can use them.
        </p>

        <div className="rounded-2xl border-2 border-b-4 border-black bg-white p-4 mb-6 space-y-3">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="Word (e.g. a friend's name)"
            className="w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'topic' | 'action')}
              className="rounded-xl border-2 border-slate-200 px-3 py-2 text-sm"
            >
              <option value="topic">Thing (topic)</option>
              <option value="action">Doing (action)</option>
            </select>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="Emoji (optional)"
              className="w-32 rounded-xl border-2 border-slate-200 px-3 py-2 text-sm"
              maxLength={4}
              disabled={!!imageData}
            />
          </div>
          <div className="flex items-center gap-3">
            <input type="file" accept="image/*" onChange={onFileChange} className="text-xs" />
            {imageData && (
              <img src={`data:image/png;base64,${imageData}`} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200" />
            )}
          </div>
          <button
            onClick={addWord}
            disabled={saving || !word.trim()}
            className="w-full rounded-xl py-2 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: '#94c1c2' }}
          >
            {saving ? 'Adding…' : 'Add word'}
          </button>
          {error && <p className="text-xs text-[#f09281] font-semibold">{error}</p>}
        </div>

        {loading ? (
          <p className="text-center text-slate-400 py-8">Loading…</p>
        ) : words.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No custom words yet.</p>
        ) : (
          <div className="space-y-2">
            {words.map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-xl border-2 border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center gap-3">
                  {w.image_data ? (
                    <img src={`data:image/png;base64,${w.image_data}`} alt="" className="w-8 h-8 rounded-lg object-cover" />
                  ) : (
                    <span className="text-xl">{w.emoji || '❓'}</span>
                  )}
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{w.word}</div>
                    <div className="text-xs text-slate-400">{w.category}</div>
                  </div>
                </div>
                <button onClick={() => removeWord(w.id)} className="text-xs font-bold text-[#f09281] px-2 py-1">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
