// Renders problem_report.context (see LocalApi.reportContext in web-client) as a triage-first
// transcript instead of a raw JSON dump — what a support/dev person actually wants first when
// reading a report: what was said, what the child was mid-answering, then the technical details.
interface DialogueEntry {
  role: 'parent' | 'child';
  content: string | string[];
  content_localized?: string;
}
interface ReportContextShape {
  setting?: string;
  question?: string;
  prefix?: string[];
  dialogue?: DialogueEntry[];
  model_version?: string;
}

export function ReportContextView({ context }: { context: unknown }) {
  const ctx = context as ReportContextShape | null;
  // Old or unrecognized shape — show the raw thing rather than hide it.
  if (!ctx || typeof ctx !== 'object' || (!Array.isArray(ctx.dialogue) && !ctx.setting)) {
    return context == null ? null : (
      <pre className="text-xs text-slate-600 bg-slate-50 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(context, null, 2)}</pre>
    );
  }

  return (
    <div className="bg-slate-50 rounded-xl p-3 text-sm">
      {ctx.dialogue && ctx.dialogue.length > 0 ? (
        <div className="space-y-2">
          {ctx.dialogue.map((m, i) => (
            <div key={i}>
              <span className={`font-bold ${m.role === 'parent' ? 'text-indigo-600' : 'text-emerald-700'}`}>
                {m.role === 'parent' ? 'Parent: ' : 'Child: '}
              </span>
              <span className="text-slate-700">
                {m.role === 'parent'
                  ? (typeof m.content === 'string' ? m.content : '')
                  : (m.content_localized || (Array.isArray(m.content) ? m.content.join(', ') : ''))}
              </span>
              {m.role === 'child' && Array.isArray(m.content) && m.content.length > 0 && (
                <span className="text-xs text-slate-400"> (tapped: {m.content.join(', ')})</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-slate-400 italic">No conversation yet in this session.</p>
      )}

      {ctx.prefix && ctx.prefix.length > 0 && (
        <p className="mt-2 text-amber-700"><span className="font-bold">Mid-answer when reported:</span> {ctx.prefix.join(', ')}</p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mt-3 pt-2 border-t border-slate-200">
        {ctx.setting && <span>Setting: <span className="font-semibold text-slate-500">{ctx.setting}</span></span>}
        {ctx.question && <span>Current question: <span className="font-semibold text-slate-500">"{ctx.question}"</span></span>}
        {ctx.model_version && <span>Model: <span className="font-semibold text-slate-500">{ctx.model_version}</span></span>}
      </div>
    </div>
  );
}
