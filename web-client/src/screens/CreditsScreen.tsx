// Third-party work the app is built on, with the licence terms each one asks for.
const CREDITS: { name: string; what: string; by: string; licence: string; url: string }[] = [
  { name: 'Mulberry Symbols', what: 'Most of the card pictures and folder covers', by: 'Paxtoncrafts Charitable Trust (Steve Lee)', licence: 'CC BY-SA 2.0 UK', url: 'https://mulberrysymbols.org' },
  { name: 'OpenMoji', what: 'Phrase cards and category icons', by: 'HfG Schwäbisch Gmünd and contributors', licence: 'CC BY-SA 4.0', url: 'https://openmoji.org' },
  { name: 'OpenDyslexic', what: 'The typeface', by: 'Abbie Gonzalez', licence: 'SIL Open Font License 1.1', url: 'https://opendyslexic.org' },
  { name: 'Cboard', what: 'The starting vocabulary lists and folders', by: 'Cboard, an open-source AAC project', licence: 'GPL-3.0 (data used with attribution)', url: 'https://www.cboard.io' },
];

export function CreditsScreen() {
  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#f0ebe1' }}>
      <div className="min-h-screen px-8 py-8 max-w-2xl mx-auto">
        <header className="mb-6">
          <h2 className="text-2xl font-extrabold text-black">Credits</h2>
        </header>
        <p className="text-sm text-slate-500 mb-4">IrisSpeak is built on these open resources. Symbol pictures keep their original licences; the card model and sentence model run on your device.</p>
        <div className="space-y-3">
          {CREDITS.map(c => (
            <div key={c.name} className="rounded-2xl border-2 border-b-4 border-black bg-white p-4">
              <div className="flex items-baseline justify-between gap-3"><span className="font-extrabold text-slate-800">{c.name}</span><span className="text-xs font-bold text-slate-400">{c.licence}</span></div>
              <div className="text-sm text-slate-600 mt-1">{c.what}. By {c.by}.</div>
              <a href={c.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#94c1c2] mt-1 inline-block">{c.url}</a>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-6">Privacy policy: <a className="underline" href="https://irisspeak.com/privacy" target="_blank" rel="noreferrer">irisspeak.com/privacy</a> · Terms: <a className="underline" href="https://irisspeak.com/terms" target="_blank" rel="noreferrer">irisspeak.com/terms</a></p>
      </div>
    </div>
  );
}
