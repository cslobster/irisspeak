import type { TopicCategory } from '../api/types';

const labels: Record<TopicCategory, string> = {
  plan: "Today's plan",
  recall: "Today's day",
  free: 'Favorites',
};

const ribbonColor: Record<TopicCategory, string> = {
  plan: 'bg-topicplan-ribbon',
  recall: 'bg-topicrecall-ribbon',
  free: 'bg-topicfree-ribbon',
};

export function SessionTitleRibbon({ topic, subtopic }: { topic: TopicCategory; subtopic?: string }) {
  return (
    <div className={`ribbon ${ribbonColor[topic]} text-lg`}>
      {subtopic ? `${labels[topic]} · ${subtopic}` : labels[topic]}
    </div>
  );
}
