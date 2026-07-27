import { useEffect, useRef, useState } from 'react';
import { MicIcon, StopIcon } from './Icons';

interface Props {
  onStop: (blob: Blob) => void;
  disabled?: boolean;
}

export function RecorderButton({ onStop, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (tickRef.current) window.clearInterval(tickRef.current);
    if (recRef.current && recRef.current.state !== 'inactive') {
      try { recRef.current.stop(); } catch {}
      recRef.current.stream.getTracks().forEach(t => t.stop());
    }
  }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        rec.stream.getTracks().forEach(t => t.stop());
        onStop(blob);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setSeconds(0);
      const t0 = Date.now();
      tickRef.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
    } catch (e: any) {
      setError(e?.message || 'Microphone permission denied.');
    }
  }

  function stop() {
    if (!recRef.current) return;
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    recRef.current.stop();
    setRecording(false);
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  return recording ? (
    <button
      onClick={stop}
      className="rounded-full bg-red-500 hover:bg-red-600 text-white px-6 py-4 shadow-lg flex items-center gap-3 font-bold animate-pulse motion-reduce:animate-none"
    >
      <StopIcon /> Stop · {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
    </button>
  ) : (
    <button
      onClick={start}
      disabled={disabled}
      className="rounded-full bg-rose-400 hover:bg-rose-500 text-white px-6 py-4 shadow-lg flex items-center gap-3 font-bold disabled:opacity-50"
    >
      <MicIcon /> Speak
    </button>
  );
}
