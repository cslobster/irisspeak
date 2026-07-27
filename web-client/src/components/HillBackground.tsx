import { ReactNode } from 'react';
import type { TopicCategory } from '../api/types';

interface Props {
  topic?: TopicCategory;
  children: ReactNode;
  className?: string;
  /** Quieter "stage" mode for focused-task screens (e.g. SessionScreen): fewer
   * decorative clouds. Sky/hills stay the same so the topic tinting is unchanged. */
  calm?: boolean;
}

const skyByTopic: Record<string, { sky: string; hill1: string; hill2: string }> = {
  default: { sky: 'from-sky-100 via-sky-50 to-white', hill1: '#a5d8a3', hill2: '#7cc176' },
  plan:    { sky: 'from-blue-100 via-sky-50 to-white', hill1: '#a3c6f6', hill2: '#669CF6' },
  recall:  { sky: 'from-green-100 via-emerald-50 to-white', hill1: '#a7e3a3', hill2: '#42CA26' },
  free:    { sky: 'from-amber-100 via-orange-50 to-white', hill1: '#FFD9A8', hill2: '#FD974B' },
};

export function HillBackground({ topic, children, className = '', calm = false }: Props) {
  const c = skyByTopic[topic || 'default'];
  return (
    <div className={`relative min-h-full w-full bg-gradient-to-b ${c.sky} ${className}`}>
      {/* Clouds — trimmed to a single one in calm mode to keep the conversation
          screen visually quiet during the child's card-tapping task. */}
      <div className="cloud" style={{ top: 80, left: '15%' }} />
      {!calm && <div className="cloud" style={{ top: 130, right: '20%', transform: 'scale(0.8)' }} />}
      {!calm && <div className="cloud" style={{ top: 220, left: '60%', transform: 'scale(0.6)', opacity: 0.7 }} />}

      {/* Hills */}
      <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 360" preserveAspectRatio="none" style={{ height: 280 }}>
        <ellipse cx="200"  cy="380" rx="500" ry="200" fill={c.hill1} opacity="0.55"/>
        <ellipse cx="900"  cy="400" rx="600" ry="220" fill={c.hill1} opacity="0.55"/>
        <ellipse cx="500"  cy="430" rx="700" ry="220" fill={c.hill2}/>
        <ellipse cx="1300" cy="440" rx="500" ry="200" fill={c.hill2}/>
      </svg>

      <div className="relative z-10 min-h-full">{children}</div>
    </div>
  );
}
