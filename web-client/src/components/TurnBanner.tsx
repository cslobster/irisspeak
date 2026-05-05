import type { DialogueRole, TopicCategory } from '../api/types';

const roleColor: Record<DialogueRole, string> = {
  parent: 'bg-blue-500 text-white',
  child:  'bg-purple-500 text-white',
};

const ribbonByTopic: Record<TopicCategory, string> = {
  plan: 'bg-topicplan-ribbon',
  recall: 'bg-topicrecall-ribbon',
  free: 'bg-topicfree-ribbon',
};

export function TurnBanner({
  role, topic, subtopic, turnNumber,
}: { role: DialogueRole; topic: TopicCategory; subtopic?: string; turnNumber: number }) {
  return (
    <div className="flex flex-row items-center gap-2 flex-wrap justify-center">
      <div className={`ribbon ${ribbonByTopic[topic]} text-sm px-4 py-1`}>
        {topic === 'plan' && "Today's plan"}
        {topic === 'recall' && "Today's day"}
        {topic === 'free' && (subtopic ? `Favorites · ${subtopic}` : 'Favorites')}
        {topic !== 'free' && subtopic ? ` · ${subtopic}` : ''}
      </div>
      <div className={`px-4 py-1.5 rounded-2xl font-extrabold text-base shadow ${roleColor[role]}`}>
        {role === 'parent' ? '🗣  Parent’s turn' : '🧒  Child’s turn'}
        <span className="ml-2 text-[11px] font-bold opacity-80">· turn {turnNumber}</span>
      </div>
    </div>
  );
}
