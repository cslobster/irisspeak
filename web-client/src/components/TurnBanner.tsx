import type { DialogueRole } from '../api/types';

const roleColor: Record<DialogueRole, string> = {
  parent: 'bg-[#94c1c2] text-white',
  child:  'bg-purple-500 text-white',
};

export function TurnBanner({
  role, turnNumber,
}: { role: DialogueRole; turnNumber: number }) {
  return (
    <div className="flex flex-row items-center gap-2 flex-wrap justify-center">
      <div className={`px-4 py-1.5 rounded-2xl font-extrabold text-base shadow ${roleColor[role]}`}>
        {role === 'parent' ? '🗣  Parent’s turn' : '🧒  Child’s turn'}
        <span className="ml-2 text-[11px] font-bold opacity-80">· turn {turnNumber}</span>
      </div>
    </div>
  );
}
