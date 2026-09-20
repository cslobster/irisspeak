import { useState } from 'react';
import html2canvas from 'html2canvas';
import { submitReport } from '../api/remote';
import { api } from '../api/local';

// "Report a problem" — separate from the model's own Feedback button (which flags wrong card
// suggestions). This is for the app itself: takes a screenshot of just the app (#root — never the
// browser chrome, since this runs in a regular browser tab), then asks what went wrong, and sends
// both plus the conversation so far to the admin site's Reports page. Fully self-contained so it
// drops in next to the Feedback button as one line, without touching how Feedback works.
async function captureAppScreenshot(): Promise<string | null> {
  const root = document.getElementById('root');
  if (!root) return null;
  try {
    const scale = Math.min(1, 1000 / root.offsetWidth);
    const canvas = await html2canvas(root, { backgroundColor: '#f0ebe1', scale, logging: false });
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch (e) { console.error('screenshot failed', e); return null; }
}

type Phase = 'closed' | 'flash' | 'sheet' | 'sending' | 'sent';

/** Same tile markup as SessionScreen.tsx's local (unexported) ActionTile, duplicated rather than
 *  imported so this component drops in without any change to that file. */
function Tile({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Report a problem with the app"
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' as any, WebkitUserSelect: 'none' }}
      className="w-[72px] h-24 sm:w-24 sm:h-28 flex flex-col items-center justify-between rounded-2xl bg-white border-2 border-b-4 border-black hover:shadow-md active:scale-95 transition-all duration-150 px-1 pt-1.5 pb-1.5 select-none disabled:opacity-40 disabled:active:scale-100"
    >
      <div className="flex-1 w-full rounded-xl flex items-center justify-center">
        <span className="text-3xl leading-none" aria-hidden="true">🚩</span>
      </div>
      <div className="w-full text-center leading-tight">
        <div className="text-xs sm:text-sm font-bold text-slate-500 line-clamp-2">Report</div>
      </div>
    </button>
  );
}

export function ReportButton() {
  const [phase, setPhase] = useState<Phase>('closed');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const shot = await captureAppScreenshot();
    setScreenshot(shot);
    setPhase('flash');
    setTimeout(() => setPhase('sheet'), 180);
  }

  function close() { setPhase('closed'); setScreenshot(null); setDescription(''); setError(null); }

  async function send() {
    if (!description.trim()) return;
    setPhase('sending'); setError(null);
    try {
      await submitReport(description.trim(), screenshot, api.feedbackContext?.session_id, api.reportContext);
      setPhase('sent');
      setTimeout(close, 1400);
    } catch (e: any) { setError(e?.message || 'Could not send — try again'); setPhase('sheet'); }
  }

  return (
    <>
      <Tile onClick={start} disabled={phase !== 'closed'} />
      {phase === 'flash' && <div className="fixed inset-0 z-[60] bg-white pointer-events-none" style={{ animation: 'reportFlash 380ms ease-out forwards' }} />}
      {(phase === 'sheet' || phase === 'sending' || phase === 'sent') && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="flex-1 bg-black/30" onClick={phase === 'sheet' ? close : undefined} />
          <div
            className="bg-[#f7f3ea] rounded-t-3xl p-5 sm:p-6 shadow-2xl"
            style={{ border: '3px solid #000', borderBottom: 'none', animation: 'reportSheetUp 220ms ease-out' }}
          >
            {screenshot && (
              <img src={screenshot} alt="" className="w-full max-h-40 object-contain object-top rounded-xl border-2 border-slate-300 mb-3" />
            )}
            <textarea
              autoFocus
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the problem here…"
              rows={3}
              disabled={phase !== 'sheet'}
              className="w-full rounded-xl border-2 border-slate-300 p-3 text-base bg-white mb-3"
            />
            {error && <p className="text-sm font-bold text-[#f09281] mb-2">{error}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={close} disabled={phase !== 'sheet'} className="pill-btn bg-white text-slate-600 border-2 border-slate-400 text-sm sm:text-base px-5 py-2 disabled:opacity-40">Cancel</button>
              <button onClick={send} disabled={phase !== 'sheet' || !description.trim()} className="pill-btn bg-[#9cc3bf] disabled:opacity-40 text-sm sm:text-base px-6 py-2">
                {phase === 'sent' ? 'Sent!' : phase === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes reportFlash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
        @keyframes reportSheetUp { 0% { transform: translateY(100%); } 100% { transform: translateY(0); } }
      `}</style>
    </>
  );
}
