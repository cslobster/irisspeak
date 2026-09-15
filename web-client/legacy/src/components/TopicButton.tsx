import { ReactNode } from 'react';
import type { TopicCategory } from '../api/types';

const config: Record<TopicCategory, { bg: string; ribbon: string }> = {
  plan:   { bg: 'bg-topicplan-fg',   ribbon: 'bg-topicplan-ribbon' },
  recall: { bg: 'bg-topicrecall-fg', ribbon: 'bg-topicrecall-ribbon' },
  free:   { bg: 'bg-topicfree-fg',   ribbon: 'bg-topicfree-ribbon' },
};

interface Props {
  topic: TopicCategory;
  title: string;
  icon: ReactNode;
  iconRotate: number;
  today: number;
  total: number;
  onClick: () => void;
  disabled?: boolean;
}

export function TopicButton({ topic, title, icon, iconRotate, today, total, onClick, disabled }: Props) {
  const c = config[topic];
  return (
    <button onClick={onClick} disabled={disabled} className={`topic-button ${c.bg} h-72 p-5`}>
      <div
        className="absolute"
        style={{
          right: topic === 'plan' ? 'auto' : '6%',
          left:  topic === 'plan' ? '20px' : 'auto',
          top: '8%',
          width: '60%',
          height: '60%',
          transform: `rotate(${iconRotate}deg)`,
        }}
      >
        {icon}
      </div>
      <div className="relative z-10 flex flex-col gap-1">
        <span className="text-3xl drop-shadow-sm">{title}</span>
        <span className="text-xs font-semibold opacity-85 mt-1">
          {today === 0 ? 'No conversations today' : `Conversations today: ${today}`}
        </span>
        <span className="text-xs font-semibold opacity-75">
          {total === 0 ? 'No total yet' : `Total conversations: ${total}`}
        </span>
      </div>
    </button>
  );
}
