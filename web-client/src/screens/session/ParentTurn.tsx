import { AskPanel } from '../../components/AskPanel';
import { Spinner } from '../../components/Spinner';
import { SETTINGS } from '../../engine/settings';

export function SettingPicker({ value, onChange, large = false }: { value: string; onChange: (v: string) => void; large?: boolean }) {
  const cur = SETTINGS.find(s => s.value === value) ?? SETTINGS[0];
  return (
    <label
      className={`flex items-center gap-3 rounded-2xl bg-white/90 backdrop-blur cursor-pointer ${large ? 'w-full h-16 pl-5 pr-4' : 'h-12 pl-3 pr-3'}`}
      style={{ boxSizing: 'border-box', border: '2px solid #000', borderBottomWidth: large ? 5 : 4 }}
    >
      <span className={`${large ? 'text-3xl' : 'text-lg'} leading-none`} aria-hidden="true">{cur.icon}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`bg-transparent font-bold text-slate-700 focus:outline-none cursor-pointer ${large ? 'flex-1 text-xl sm:text-2xl' : 'text-sm'}`}
        aria-label="Where are you talking?"
      >
        {SETTINGS.map(s => <option key={s.value} value={s.value}>{large ? s.label : s.label.split(' ')[0]}</option>)}
      </select>
    </label>
  );
}

export function Loader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <Spinner size={112} />
      <p className="text-base font-bold text-slate-600">{label}</p>
    </div>
  );
}

interface ParentTurnProps {
  setting: string;
  onSettingChange: (v: string) => void;
  parentMessage: string;
  setParentMessage: (s: string) => void;
  onSubmit: () => void;
  onAsk: (text: string) => void;
  isRecording: boolean;
  partialTranscript: string;
  onMicTap: () => void;
}

export function ParentTurn({ setting, onSettingChange, parentMessage, setParentMessage, onSubmit, onAsk, isRecording, partialTranscript, onMicTap }: ParentTurnProps) {
  return (
    <div className="w-full h-full flex flex-col mx-auto px-3 py-2 min-h-0">
      <AskPanel setting={setting} onSettingChange={onSettingChange} onAsk={onAsk}
        parentMessage={parentMessage} setParentMessage={setParentMessage} onSubmit={onSubmit}
        isRecording={isRecording} partialTranscript={partialTranscript} onMicTap={onMicTap} />
    </div>
  );
}
