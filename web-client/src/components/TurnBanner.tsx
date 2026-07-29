import type { DialogueRole } from '../api/types';

const roleTint: Record<DialogueRole, string> = {
  parent: 'bg-[#94c1c2]/15',
  child:  'bg-purple-100',
};

/** Shows what the *other* person just said, instead of a "whose turn" label:
 * on the child's turn, the parent's last spoken message; on the parent's
 * turn, the child's last accepted sentence (not the raw tapped cards). */
export function TurnBanner({
  role, parentText, childText,
}: { role: DialogueRole; parentText: string | null; childText: string | null }) {
  const text = role === 'child' ? parentText : childText;
  if (!text) return null;

  return (
    <div
      className={`max-w-2xl px-5 py-2.5 rounded-2xl font-bold text-base sm:text-lg text-center text-slate-700 ${roleTint[role]}`}
      style={{ border: '2px solid #000', borderBottomWidth: 4, boxSizing: 'border-box' }}
    >
      “{text}”
    </div>
  );
}
