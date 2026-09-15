import type { DialogueRole } from '../api/types';
import { speak } from '../audio/tts';
import { SoundOnIcon } from './Icons';

const roleTint: Record<DialogueRole, string> = {
  parent: 'bg-[#94c1c2]/15',
  child:  'bg-purple-100',
};

/** Shows what the *other* person just said, instead of a "whose turn" label:
 * on the child's turn, the parent's last spoken message; on the parent's
 * turn, every sentence the child banked this turn (not the raw tapped cards) --
 * shown as separate lines so a multi-sentence turn doesn't read as one run-on. */
export function TurnBanner({
  role, parentText, childText,
}: { role: DialogueRole; parentText: string | null; childText: string[] }) {
  if (role === 'child') {
    // Once the child has said something this turn, the banner shows that sentence (with a speaker to hear it
    // again) instead of the question.
    const said = childText.length ? childText[childText.length - 1] : null;
    if (said) {
      return (
        <div
          className={`max-w-2xl pl-5 pr-2 py-1.5 rounded-2xl font-bold text-base sm:text-lg text-center text-slate-700 flex items-center gap-3 ${roleTint.parent}`}
          style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
        >
          <span>“{said}”</span>
          <button onClick={() => speak(said)} aria-label="Say it again" title="Say it again"
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-white active:scale-95 transition-transform flex-shrink-0"
            style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}>
            <SoundOnIcon size={20} color="#475569" />
          </button>
        </div>
      );
    }
    if (!parentText) return null;
    return (
      <div
        className={`max-w-2xl px-5 py-2.5 rounded-2xl font-bold text-base sm:text-lg text-center text-slate-700 ${roleTint.child}`}
        style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
      >
        “{parentText}”
      </div>
    );
  }

  if (childText.length === 0) return null;

  return (
    <div
      className={`max-w-2xl px-5 py-2.5 rounded-2xl font-bold text-base sm:text-lg text-center text-slate-700 flex flex-col gap-1.5 ${roleTint.parent}`}
      style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
    >
      {childText.map((sentence, i) => (
        <div key={i}>“{sentence}”</div>
      ))}
    </div>
  );
}
