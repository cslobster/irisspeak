import { useEffect } from 'react';

/** Full-screen view of a report screenshot — the inline thumbnail is too small to read card
 *  labels or fine detail. Click the backdrop, the ✕, or Escape to close. */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4" onClick={e => { e.stopPropagation(); onClose(); }}>
      <img src={src} alt="Screenshot, full size" className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
      <button onClick={e => { e.stopPropagation(); onClose(); }} aria-label="Close" className="absolute top-4 right-5 text-white text-4xl leading-none hover:text-slate-300 transition">✕</button>
    </div>
  );
}
