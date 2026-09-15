import type { DialogueRole } from '../api/types';

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
