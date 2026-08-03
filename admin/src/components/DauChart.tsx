import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { adminApi } from '../api';
import type { DauRow } from '../api';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const VIEW_W = 760;
const VIEW_H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 32 };
const PLOT_W = VIEW_W - PAD.left - PAD.right;
const PLOT_H = VIEW_H - PAD.top - PAD.bottom;

const ACCENT = '#6366f1'; // Tailwind indigo-500 — matches the accent already used across the dashboard

function formatDateLabel(iso: string): string {
  // The backend serializes a Postgres `date` as a full ISO timestamp (e.g.
  // "2026-08-03T07:00:00.000Z"), not a bare "YYYY-MM-DD" — take just the date portion so we
  // don't end up appending a second "T..." onto an already-full timestamp (produces Invalid Date).
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Rounds the axis ceiling up to a clean, evenly-divisible integer step rather than the raw max —
// user counts are always whole numbers, so ticks like 0/3/6/9/12 read better than 0/2.75/5.5/...
function computeYAxis(maxValue: number) {
  const step = Math.max(1, Math.ceil(Math.max(maxValue, 1) / 4));
  const axisMax = step * 4;
  return { axisMax, ticks: [0, step, step * 2, step * 3, axisMax] };
}

export function DauChart() {
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<DauRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(async (days: Range) => {
    setLoading(true); setError('');
    try { setData(await adminApi.getDAU(days)); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(range); }, [load, range]);

  const { axisMax, ticks } = useMemo(
    () => computeYAxis(Math.max(0, ...data.map((d) => d.active_users))),
    [data],
  );

  const points = useMemo(() => {
    const n = data.length;
    return data.map((d, i) => ({
      x: PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * PLOT_W),
      y: PAD.top + PLOT_H - (d.active_users / axisMax) * PLOT_H,
      ...d,
    }));
  }, [data, axisMax]);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)} `
      + `L${points[0].x.toFixed(1)},${(PAD.top + PLOT_H).toFixed(1)} Z`
    : '';

  const todayCount = data.length ? data[data.length - 1].active_users : 0;
  const peak = data.reduce((best, d) => (d.active_users > (best?.active_users ?? -1) ? d : best), null as DauRow | null);
  const avg = data.length ? Math.round((data.reduce((a, d) => a + d.active_users, 0) / data.length) * 10) / 10 : 0;

  function handlePointerMove(clientX: number) {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * VIEW_W;
    const n = points.length;
    const i = n <= 1 ? 0 : Math.round(((relX - PAD.left) / PLOT_W) * (n - 1));
    setHoverIdx(Math.min(n - 1, Math.max(0, i)));
  }

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="bg-white rounded-2xl shadow border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-700">Daily Active Users</h2>
          <p className="text-xs text-slate-400 font-semibold mt-0.5">Unique users with any activity, per day</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${
                  range === r ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {r}d
              </button>
            ))}
          </div>
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {(['chart', 'table'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${
                  view === v ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {v === 'chart' ? 'Chart' : 'Table'}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(range)}
            className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-600 transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{error}</p>}

      {!loading && data.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <KpiCard label="Today" value={todayCount} />
          <KpiCard label="Peak Day" value={peak?.active_users ?? 0} sub={peak ? formatDateLabel(peak.date) : undefined} />
          <KpiCard label={`${range}-Day Average`} value={avg} />
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-slate-400 font-semibold">Loading…</div>
      ) : data.length === 0 ? (
        <div className="text-center py-16 text-slate-400 font-semibold">No activity recorded yet.</div>
      ) : view === 'table' ? (
        <div className="max-h-80 overflow-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-widest">
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-center">Active Users</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-b border-slate-50">
                  <td className="px-5 py-2.5 text-slate-600 font-semibold">{formatDateLabel(d.date)}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className="inline-block px-3 py-0.5 rounded-full text-xs font-extrabold bg-indigo-100 text-indigo-700">
                      {d.active_users}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-auto touch-none"
            onMouseMove={(e) => handlePointerMove(e.clientX)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* gridlines + y-axis ticks */}
            {ticks.map((t) => {
              const y = PAD.top + PLOT_H - (t / axisMax) * PLOT_H;
              return (
                <g key={t}>
                  <line x1={PAD.left} y1={y} x2={VIEW_W - PAD.right} y2={y} stroke="#e2e8f0" strokeWidth={1} />
                  <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8" fontWeight={600}>
                    {t}
                  </text>
                </g>
              );
            })}

            {/* x-axis: first / middle / last date only, to avoid label crowding at 30/90d */}
            {[0, Math.floor((points.length - 1) / 2), points.length - 1]
              .filter((i, idx, arr) => arr.indexOf(i) === idx)
              .map((i) => (
                <text
                  key={i}
                  x={points[i].x}
                  y={VIEW_H - 8}
                  textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                  fontSize={10}
                  fill="#94a3b8"
                  fontWeight={600}
                >
                  {formatDateLabel(points[i].date)}
                </text>
              ))}

            <path d={areaPath} fill={ACCENT} fillOpacity={0.1} stroke="none" />
            <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {/* direct end-label on the last point */}
            {points.length > 0 && (
              <>
                <circle
                  cx={points[points.length - 1].x}
                  cy={points[points.length - 1].y}
                  r={4}
                  fill={ACCENT}
                  stroke="#fff"
                  strokeWidth={2}
                />
                <text
                  x={points[points.length - 1].x - 8}
                  y={points[points.length - 1].y - 10}
                  textAnchor="end"
                  fontSize={11}
                  fill="#334155"
                  fontWeight={800}
                >
                  {points[points.length - 1].active_users}
                </text>
              </>
            )}

            {/* hover crosshair + marker */}
            {hovered && (
              <g>
                <line
                  x1={hovered.x} y1={PAD.top} x2={hovered.x} y2={PAD.top + PLOT_H}
                  stroke="#c7d2fe" strokeWidth={1}
                />
                <circle cx={hovered.x} cy={hovered.y} r={4} fill={ACCENT} stroke="#fff" strokeWidth={2} />
              </g>
            )}
          </svg>

          {hovered && (
            <div
              className="absolute pointer-events-none bg-slate-800 text-white text-xs font-semibold rounded-lg px-3 py-2 shadow-lg -translate-x-1/2"
              style={{
                left: `${(hovered.x / VIEW_W) * 100}%`,
                top: `${Math.max(0, (hovered.y / VIEW_H) * 100 - 14)}%`,
              }}
            >
              <div className="font-extrabold">{hovered.active_users} active</div>
              <div className="text-slate-300">{formatDateLabel(hovered.date)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-2xl border-2 border-indigo-100 bg-indigo-50 p-5">
      <div className="text-3xl font-extrabold text-indigo-700">{value}</div>
      <div className="text-xs font-bold uppercase tracking-widest mt-1 text-indigo-500 opacity-70">{label}</div>
      {sub && <div className="text-xs text-indigo-400 font-semibold mt-0.5">{sub}</div>}
    </div>
  );
}
