// Floating "Recording…" indicator with a live volume dot.
import type { RecorderState } from '../audio/recorder';

export function RecordingPill({ state, level }: { state: RecorderState; level: number }) {
  if (state === 'idle') return null;
  const recording = state === 'recording';
  const scale = 0.5 + Math.min(level * 5, 1) * 0.7;
  return (
    <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-white/90 px-4 py-2 rounded-full shadow border border-rose-200">
      <div className="w-6 h-6 rounded-full border-2 border-rose-300 flex items-center justify-center">
        <div
          className={`w-6 h-6 rounded-full ${recording ? 'bg-rose-500' : 'bg-rose-300'} transition-transform`}
          style={{ transform: `scale(${recording ? scale : 0.5})` }}
        />
      </div>
      <span className={`text-sm font-bold ${recording ? 'text-rose-600' : 'text-slate-500'} ${recording ? 'animate-pulse motion-reduce:animate-none' : ''}`}>
        {recording ? 'Recording…' : 'Paused'}
      </span>
    </div>
  );
}
