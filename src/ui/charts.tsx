/**
 * Hand-written inline-SVG chart primitives for the analytics dashboard.
 *
 * No chart library, no CDN, no network. Every mark is an SVG element written
 * here. Colours come from CSS custom properties defined in `dashboard.css`
 * (see the palette notes there) and are passed in as `var(--dash-*)` strings,
 * applied through `style` so the custom property actually resolves.
 *
 * Design rules followed (dataviz skill):
 *  - form chosen by the data's job; sequential/one-hue for magnitude,
 *    categorical only where the series ARE the subject, diverging for polarity.
 *  - thin marks, hairline solid grid, 2px lines, >=8px markers,
 *    2px surface gap between touching fills, 2px surface ring on dots.
 *  - a legend whenever there are >= 2 series, selective direct labels,
 *    text always in text tokens (never the series colour),
 *  - every chart carries a table view (<details>) so nothing is colour-only.
 */

import {
  useCallback, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ */
/* palette slots                                                       */
/* ------------------------------------------------------------------ */

/** Categorical slots, in fixed order. Never cycled, never generated. */
export const SERIES = [
  'var(--dash-s1)', 'var(--dash-s2)', 'var(--dash-s3)',
  'var(--dash-s4)', 'var(--dash-s5)',
] as const;

export const INK = 'var(--dash-ink)';
export const INK2 = 'var(--dash-ink-2)';
export const MUTED = 'var(--dash-muted)';
export const GRID = 'var(--dash-grid)';
export const AXIS = 'var(--dash-axis)';
export const SURFACE = 'var(--dash-surface)';
export const POS = 'var(--dash-pos)';
export const NEG = 'var(--dash-neg)';

/* ------------------------------------------------------------------ */
/* measuring: charts render at 1:1 device px so labels never shrink    */
/* ------------------------------------------------------------------ */

export function useMeasure<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(0, Math.round(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0];
  if (max === min) { const p = Math.abs(max) || 1; min -= p * 0.5; max += p * 0.5; }
  const span = max - min;
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(+v.toFixed(10));
  }
  return out.length ? out : [min, max];
}

export function fmtPct(v: number, dp = 1): string {
  return `${(v * 100).toFixed(dp)}%`;
}

export function fmtClock(seconds: number): string {
  if (!isFinite(seconds)) return '--';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtNum(v: number, dp = 1): string {
  if (!isFinite(v)) return '--';
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(dp);
}

/** Does `text` fit inside `px` pixels at `size`px in the UI sans? Rough but safe. */
function fits(text: string, px: number, size: number): boolean {
  return text.length * size * 0.58 + 16 <= px;
}

/** Rect path with per-corner radii, so only the outer data-end is rounded. */
function roundedRect(
  x: number, y: number, w: number, h: number,
  r: { tl?: number; tr?: number; br?: number; bl?: number },
): string {
  const cap = Math.min(w, h) / 2;
  const tl = Math.min(r.tl ?? 0, cap), tr = Math.min(r.tr ?? 0, cap);
  const br = Math.min(r.br ?? 0, cap), bl = Math.min(r.bl ?? 0, cap);
  return [
    `M${x + tl} ${y}`,
    `H${x + w - tr}`, tr ? `A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : '',
    `V${y + h - br}`, br ? `A${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : '',
    `H${x + bl}`, bl ? `A${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : '',
    `V${y + tl}`, tl ? `A${tl} ${tl} 0 0 1 ${x + tl} ${y}` : '',
    'Z',
  ].join('');
}

/* ------------------------------------------------------------------ */
/* chart card: title, legend, plot, footnote, table view               */
/* ------------------------------------------------------------------ */

export interface TableView { columns: string[]; rows: (string | number)[][] }

export interface LegendItem { label: string; color: string; shape?: 'swatch' | 'line' | 'band' }

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="dash-legend">
      {items.map((it) => (
        <li key={it.label} className="dash-legend-item">
          <span
            className={`dash-key dash-key-${it.shape ?? 'swatch'}`}
            style={{ background: it.color }}
            aria-hidden="true"
          />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ table, label }: { table: TableView; label: string }) {
  return (
    <details className="dash-tableview">
      <summary>Data table &mdash; {label}</summary>
      <div className="dash-tableview-scroll">
        <table>
          <thead>
            <tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  j === 0
                    ? <th key={j} scope="row">{cell}</th>
                    : <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function ChartCard(props: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  note?: ReactNode;
  table?: TableView;
  wide?: boolean;
  children: (width: number) => ReactNode;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  return (
    <section className={`dash-card${props.wide ? ' dash-card-wide' : ''}`}>
      <header className="dash-card-head">
        <h3 className="dash-card-title">{props.title}</h3>
        {props.subtitle ? <p className="dash-card-sub">{props.subtitle}</p> : null}
        {props.legend && props.legend.length > 1 ? <Legend items={props.legend} /> : null}
      </header>
      <div className="dash-plot" ref={ref}>
        {width > 0 ? props.children(width) : null}
      </div>
      {props.note ? <p className="dash-card-note">{props.note}</p> : null}
      {props.table ? <DataTable table={props.table} label={props.title} /> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* stat tiles                                                          */
/* ------------------------------------------------------------------ */

export function StatTile(props: {
  label: string; value: string; unit?: string; sub?: ReactNode; hero?: boolean;
  accent?: string;
}) {
  return (
    <div className={`dash-tile${props.hero ? ' dash-tile-hero' : ''}`}>
      <p className="dash-tile-label">{props.label}</p>
      <p className="dash-tile-value">
        {props.accent ? (
          <span className="dash-tile-dot" style={{ background: props.accent }} aria-hidden="true" />
        ) : null}
        {props.value}
        {props.unit ? <span className="dash-tile-unit">{props.unit}</span> : null}
      </p>
      {props.sub ? <p className="dash-tile-sub">{props.sub}</p> : null}
    </div>
  );
}

/**
 * A proportion shown as a meter with its 95% interval drawn on the track.
 * Track is a lighter step of the fill's own ramp (same-hue), per the meter spec.
 */
export function IntervalMeter({ width, p, lo, hi, color = SERIES[0] }: {
  width: number; p: number; lo: number; hi: number; color?: string;
}) {
  const h = 26, pad = 2, w = Math.max(80, width);
  const x = (v: number) => pad + v * (w - pad * 2);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`${fmtPct(p)}, 95% interval ${fmtPct(lo)} to ${fmtPct(hi)}`}>
      <rect x={pad} y={9} width={w - pad * 2} height={8} rx={4} style={{ fill: 'var(--dash-track)' }} />
      <rect x={pad} y={9} width={Math.max(4, x(p) - pad)} height={8} rx={4} style={{ fill: color }} />
      <line x1={x(lo)} x2={x(hi)} y1={13} y2={13} strokeWidth={2} strokeLinecap="round"
        style={{ stroke: INK2 }} opacity={0.85} />
      <line x1={x(lo)} x2={x(lo)} y1={6} y2={20} strokeWidth={2} style={{ stroke: INK2 }} opacity={0.85} />
      <line x1={x(hi)} x2={x(hi)} y1={6} y2={20} strokeWidth={2} style={{ stroke: INK2 }} opacity={0.85} />
      <circle cx={x(p)} cy={13} r={5} style={{ fill: color, stroke: SURFACE }} strokeWidth={2} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* dot-and-interval plot (win rate per format)                         */
/* ------------------------------------------------------------------ */

export interface IntervalRow {
  label: string; p: number; lo: number; hi: number; k: number; n: number;
  id?: string; selected?: boolean;
}

export function IntervalDotPlot({ width, rows, baseline = 0.5, onPick }: {
  width: number; rows: IntervalRow[]; baseline?: number;
  onPick?: (id: string) => void;
}) {
  const labelW = Math.min(76, Math.max(52, Math.round(width * 0.17)));
  const m = { l: labelW, r: Math.min(128, Math.max(84, Math.round(width * 0.24))), t: 10, b: 30 };
  const rowH = 34;
  const h = m.t + rows.length * rowH + m.b;
  const iw = Math.max(40, width - m.l - m.r);
  const x = (v: number) => m.l + v * iw;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="dash-svg"
      role="img" aria-label="A-side win rate per format with 95% Wilson intervals">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={m.t} y2={m.t + rows.length * rowH}
            strokeWidth={1} style={{ stroke: GRID }} />
          <text x={x(t)} y={m.t + rows.length * rowH + 18} textAnchor="middle"
            className="dash-axis-text">{Math.round(t * 100)}%</text>
        </g>
      ))}
      <line x1={x(baseline)} x2={x(baseline)} y1={m.t - 2} y2={m.t + rows.length * rowH + 2}
        strokeWidth={1} style={{ stroke: AXIS }} />
      <text x={x(baseline)} y={m.t - 6} textAnchor="middle"
        className="dash-axis-text dash-axis-strong">coin-flip</text>

      {rows.map((r, i) => {
        const cy = m.t + i * rowH + rowH / 2;
        return (
          <g key={r.label} className={`dash-introw${r.selected ? ' is-sel' : ''}`}
            onClick={onPick && r.id ? () => onPick(r.id!) : undefined}
            style={onPick ? { cursor: 'pointer' } : undefined}>
            <title>{`${r.label}: ${fmtPct(r.p)} (${r.k} / ${r.n}); 95% Wilson ${fmtPct(r.lo)} to ${fmtPct(r.hi)}`}</title>
            <rect x={0} y={cy - rowH / 2} width={width} height={rowH}
              style={{ fill: r.selected ? 'var(--dash-row-sel)' : 'transparent' }} />
            <text x={m.l - 10} y={cy + 4} textAnchor="end" className="dash-axis-text dash-axis-strong">
              {r.label}
            </text>
            <line x1={x(r.lo)} x2={x(r.hi)} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round"
              style={{ stroke: INK2 }} opacity={0.8} />
            <line x1={x(r.lo)} x2={x(r.lo)} y1={cy - 6} y2={cy + 6} strokeWidth={2} style={{ stroke: INK2 }} opacity={0.8} />
            <line x1={x(r.hi)} x2={x(r.hi)} y1={cy - 6} y2={cy + 6} strokeWidth={2} style={{ stroke: INK2 }} opacity={0.8} />
            <circle cx={x(r.p)} cy={cy} r={5} style={{ fill: SERIES[0], stroke: SURFACE }} strokeWidth={2} />
            <text x={width - 6} y={cy + 4} textAnchor="end" className="dash-axis-text dash-value-text">
              {fmtPct(r.p)}
              <tspan className="dash-axis-text"> &middot; {r.k}/{r.n}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* horizontal bar rows (nominal categories, one hue)                   */
/* ------------------------------------------------------------------ */

export function BarRows({ width, rows, valueLabel, color = SERIES[0], maxOverride }: {
  width: number;
  rows: { label: string; value: number; note?: string }[];
  valueLabel: (v: number) => string;
  color?: string;
  maxOverride?: number;
}) {
  const labelW = Math.min(180, Math.max(84, Math.round(width * 0.34)));
  const m = { l: labelW, r: 72, t: 6, b: 6 };
  const rowH = 30, barH = 18;
  const h = m.t + rows.length * rowH + m.b;
  const iw = Math.max(30, width - m.l - m.r);
  const max = maxOverride ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="dash-svg" role="img"
      aria-label="Breakdown by category">
      {rows.map((r, i) => {
        const y = m.t + i * rowH + (rowH - barH) / 2;
        const bw = Math.max(2, (r.value / max) * iw);
        return (
          <g key={r.label}>
            <title>{`${r.label}: ${valueLabel(r.value)}${r.note ? ` (${r.note})` : ''}`}</title>
            <text x={m.l - 10} y={y + barH / 2 + 4} textAnchor="end" className="dash-axis-text">{r.label}</text>
            <rect x={m.l} y={y} width={bw} height={barH} rx={4} style={{ fill: color }} />
            <rect x={m.l} y={y} width={Math.min(4, bw)} height={barH} style={{ fill: color }} />
            <text x={m.l + bw + 8} y={y + barH / 2 + 4} className="dash-axis-text dash-value-text">
              {valueLabel(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* column chart (ordered bins: round of finish, duration histogram)    */
/* ------------------------------------------------------------------ */

export function ColumnBars({ width, bins, valueLabel, yLabel, color = SERIES[0], height = 190, labelEvery = 1 }: {
  width: number;
  bins: { label: string; value: number }[];
  valueLabel: (v: number) => string;
  yLabel?: string;
  color?: string;
  height?: number;
  labelEvery?: number;
}) {
  const m = { l: 44, r: 12, t: 16, b: 34 };
  const iw = Math.max(20, width - m.l - m.r);
  const ih = Math.max(40, height - m.t - m.b);
  const max = Math.max(1, ...bins.map((b) => b.value));
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ticks[ticks.length - 1] || max);
  const band = iw / Math.max(1, bins.length);
  const barW = Math.min(24, Math.max(6, band - 10));
  const y = (v: number) => m.t + ih - (v / top) * ih;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="dash-svg" role="img"
      aria-label={yLabel ?? 'Distribution'}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: GRID }} />
          <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="dash-axis-text">{fmtNum(t, 0)}</text>
        </g>
      ))}
      <line x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} strokeWidth={1} style={{ stroke: AXIS }} />
      {bins.map((b, i) => {
        const cx = m.l + band * i + band / 2;
        const bh = Math.max(b.value > 0 ? 2 : 0, (b.value / top) * ih);
        const show = i % labelEvery === 0;
        return (
          <g key={`${b.label}-${i}`}>
            <title>{`${b.label}: ${valueLabel(b.value)}`}</title>
            <rect x={cx - barW / 2} y={m.t + ih - bh} width={barW} height={bh} rx={4} style={{ fill: color }} />
            <rect x={cx - barW / 2} y={m.t + ih - Math.min(4, bh)} width={barW} height={Math.min(4, bh)}
              style={{ fill: color }} />
            {show && fits(b.label, band, 11) ? (
              <text x={cx} y={height - 10} textAnchor="middle" className="dash-axis-text">{b.label}</text>
            ) : null}
          </g>
        );
      })}
      {yLabel ? <text x={m.l - 36} y={m.t - 5} className="dash-axis-text">{yLabel}</text> : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* stacked share bar (part-to-whole, categorical, 2px surface gaps)    */
/* ------------------------------------------------------------------ */

export function StackedShare({ width, parts, total, unit }: {
  width: number;
  parts: { label: string; value: number; color: string }[];
  total: number;
  unit: (v: number) => string;
}) {
  const h = 96, barY = 8, barH = 34, GAP = 2;
  const sum = total > 0 ? total : parts.reduce((a, p) => a + p.value, 0) || 1;
  let x = 0;
  const laid = parts.map((p) => {
    const w = (p.value / sum) * width;
    const seg = { ...p, x, w, share: p.value / sum };
    x += w;
    return seg;
  });
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="dash-svg" role="img"
      aria-label="Share breakdown">
      {laid.map((s, i) => {
        const w = Math.max(0, s.w - (i < laid.length - 1 ? GAP : 0));
        const pctText = `${(s.share * 100).toFixed(0)}%`;
        const inside = w >= 34 && fits(pctText, w, 12);
        return (
          <g key={s.label}>
            <title>{`${s.label}: ${unit(s.value)} (${(s.share * 100).toFixed(1)}%)`}</title>
            <path
              d={roundedRect(s.x, barY, w, barH, {
                tl: i === 0 ? 4 : 0, bl: i === 0 ? 4 : 0,
                tr: i === laid.length - 1 ? 4 : 0, br: i === laid.length - 1 ? 4 : 0,
              })}
              style={{ fill: s.color }}
            />
            {inside ? (
              <text x={s.x + w / 2} y={barY + barH / 2 + 4} textAnchor="middle"
                className="dash-inseg-text">{pctText}</text>
            ) : null}
          </g>
        );
      })}
      {laid.map((s, i) => {
        const w = Math.max(0, s.w - GAP);
        if (w < 46) return null;
        const t = unit(s.value);
        if (!fits(t, w, 11)) return null;
        return (
          <text key={`v-${s.label}`} x={s.x + w / 2} y={barY + barH + 18} textAnchor="middle"
            className="dash-axis-text">{t}</text>
        );
      })}
      <text x={0} y={h - 8} className="dash-axis-text">
        {`total ${unit(sum)}`}
      </text>
      {width >= 520 ? (
        <text x={width} y={h - 8} textAnchor="end" className="dash-axis-text">
          {`${laid.length} categories · hover a segment, or open the data table`}
        </text>
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* quartile strip (median + IQR + whiskers)                            */
/* ------------------------------------------------------------------ */

export function QuartileStrip({ width, min, q1, med, q3, max, domainMax, fmt, color = SERIES[0] }: {
  width: number; min: number; q1: number; med: number; q3: number; max: number;
  domainMax?: number; fmt: (v: number) => string; color?: string;
}) {
  const h = 74, m = { l: 6, r: 6, t: 8, b: 26 };
  const hi = domainMax ?? max;
  const iw = Math.max(20, width - m.l - m.r);
  const x = (v: number) => m.l + (hi > 0 ? Math.min(1, Math.max(0, v / hi)) : 0) * iw;
  const cy = m.t + 18;
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} className="dash-svg" role="img"
      aria-label={`Median ${fmt(med)}, interquartile range ${fmt(q1)} to ${fmt(q3)}, range ${fmt(min)} to ${fmt(max)}`}>
      <title>{`median ${fmt(med)} · IQR ${fmt(q1)}–${fmt(q3)} · range ${fmt(min)}–${fmt(max)}`}</title>
      <line x1={x(min)} x2={x(max)} y1={cy} y2={cy} strokeWidth={2} strokeLinecap="round"
        style={{ stroke: AXIS }} />
      <rect x={x(q1)} y={cy - 11} width={Math.max(3, x(q3) - x(q1))} height={22} rx={4}
        style={{ fill: color }} opacity={0.32} />
      <line x1={x(med)} x2={x(med)} y1={cy - 13} y2={cy + 13} strokeWidth={2} strokeLinecap="round"
        style={{ stroke: color }} />
      <circle cx={x(med)} cy={cy} r={4.5} style={{ fill: color, stroke: SURFACE }} strokeWidth={2} />
      <text x={x(med)} y={cy - 18} textAnchor="middle" className="dash-value-text">{fmt(med)}</text>
      <text x={m.l} y={h - 8} className="dash-axis-text">{`min ${fmt(min)}`}</text>
      <text x={m.l + iw / 2} y={h - 8} textAnchor="middle" className="dash-axis-text">
        {`IQR ${fmt(q1)} – ${fmt(q3)}`}
      </text>
      <text x={m.l + iw} y={h - 8} textAnchor="end" className="dash-axis-text">{`max ${fmt(max)}`}</text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* trajectory chart: mean lines + IQR bands + sample-size strip        */
/* ------------------------------------------------------------------ */

export interface TrajectorySeries {
  key: string; label: string; color: string;
  mean: number[]; lo: number[]; hi: number[];
}

interface HoverState { i: number; x: number }

function pathFrom(pts: [number, number][], from: number, to: number): string {
  let d = '';
  for (let i = from; i <= to && i < pts.length; i++) {
    d += `${i === from ? 'M' : 'L'}${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`;
  }
  return d;
}

function bandPath(hiPts: [number, number][], loPts: [number, number][], from: number, to: number): string {
  if (to <= from) return '';
  let d = '';
  for (let i = from; i <= to; i++) d += `${i === from ? 'M' : 'L'}${hiPts[i][0].toFixed(2)} ${hiPts[i][1].toFixed(2)}`;
  for (let i = to; i >= from; i--) d += `L${loPts[i][0].toFixed(2)} ${loPts[i][1].toFixed(2)}`;
  return d + 'Z';
}

export function TrajectoryChart(props: {
  width: number;
  series: TrajectorySeries[];
  /** bouts still contributing at each sample index */
  counts: number[];
  totalBouts: number;
  sampleSeconds: number;
  yDomain?: [number, number];
  yFormat: (v: number) => string;
  height?: number;
  /** below this share of bouts, marks are drawn faded */
  fadeBelow?: number;
}) {
  const {
    width, series, counts, totalBouts, sampleSeconds,
    yFormat, height = 250, fadeBelow = 0.5,
  } = props;

  const n = counts.length;
  const stripH = 34;
  const empty = n === 0 || series.length === 0;
  const m = { l: 46, r: 14, t: 12, b: 30 };
  const plotH = Math.max(60, height - m.t - m.b - stripH);
  const iw = Math.max(30, width - m.l - m.r);

  const [dom0, dom1] = props.yDomain ?? (() => {
    if (empty) return [0, 1] as [number, number];
    let lo = Infinity, hi = -Infinity;
    for (const s of series) {
      for (let i = 0; i < n; i++) {
        if (counts[i] === 0) continue;
        lo = Math.min(lo, s.lo[i]); hi = Math.max(hi, s.hi[i]);
      }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 || 0.1;
    return [lo - pad, hi + pad] as [number, number];
  })();

  const ticks = niceTicks(dom0, dom1, 4);
  const x = (i: number) => m.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + plotH - ((v - dom0) / (dom1 - dom0 || 1)) * plotH;

  /** last index where enough bouts are still running */
  const solidTo = useMemo(() => {
    let k = 0;
    for (let i = 0; i < n; i++) if (counts[i] >= fadeBelow * totalBouts) k = i;
    return k;
  }, [counts, n, fadeBelow, totalBouts]);

  const [hover, setHover] = useState<HoverState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el || n <= 1) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left;
    const frac = (px - m.l) / iw;
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHover({ i, x: x(i) });
  }, [n, iw, m.l]);

  const pts = series.map((s) => ({
    mean: s.mean.map((v, i) => [x(i), y(v)] as [number, number]),
    lo: s.lo.map((v, i) => [x(i), y(v)] as [number, number]),
    hi: s.hi.map((v, i) => [x(i), y(v)] as [number, number]),
  }));

  const stripTop = m.t + plotH + m.b - 8;
  const maxCount = Math.max(1, totalBouts);

  if (empty) return <p className="dash-card-note">No trajectory samples for this format.</p>;

  return (
    <div className="dash-hoverwrap">
      <svg
        ref={svgRef}
        width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="dash-svg"
        role="img"
        aria-label={`${series.map((s) => s.label).join(' and ')} over simulated time, mean with interquartile band`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: GRID }} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="dash-axis-text">{yFormat(t)}</text>
          </g>
        ))}
        {dom0 < 0 && dom1 > 0 ? (
          <line x1={m.l} x2={m.l + iw} y1={y(0)} y2={y(0)} strokeWidth={1} style={{ stroke: AXIS }} />
        ) : null}

        {/* interquartile bands: a 10% wash, never a saturated block */}
        {series.map((s, si) => (
          <g key={`band-${s.key}`}>
            <path d={bandPath(pts[si].hi, pts[si].lo, 0, solidTo)} style={{ fill: s.color }} opacity={0.14} />
            {solidTo < n - 1 ? (
              <path d={bandPath(pts[si].hi, pts[si].lo, solidTo, n - 1)} style={{ fill: s.color }} opacity={0.06} />
            ) : null}
          </g>
        ))}

        {/* sample-size fall-off marker */}
        {solidTo < n - 1 ? (
          <g>
            <line x1={x(solidTo)} x2={x(solidTo)} y1={m.t} y2={m.t + plotH} strokeWidth={1} style={{ stroke: AXIS }} />
            <text x={Math.min(x(solidTo) + 6, width - 6)} y={m.t + 11}
              textAnchor={x(solidTo) > width - 130 ? 'end' : 'start'} className="dash-axis-text">
              {`n < ${Math.round(fadeBelow * 100)}% past here`}
            </text>
          </g>
        ) : null}

        {series.map((s, si) => (
          <g key={`line-${s.key}`}>
            <path d={pathFrom(pts[si].mean, 0, solidTo)} fill="none" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" style={{ stroke: s.color }} />
            {solidTo < n - 1 ? (
              <path d={pathFrom(pts[si].mean, solidTo, n - 1)} fill="none" strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" style={{ stroke: s.color }} opacity={0.4} />
            ) : null}
            {/* direct end label on the last well-sampled point */}
            <circle cx={pts[si].mean[solidTo]?.[0]} cy={pts[si].mean[solidTo]?.[1]} r={4.5}
              style={{ fill: s.color, stroke: SURFACE }} strokeWidth={2} />
          </g>
        ))}

        {hover && counts[hover.i] > 0 ? (
          <g>
            <line x1={hover.x} x2={hover.x} y1={m.t} y2={m.t + plotH} strokeWidth={1} style={{ stroke: AXIS }} />
            {series.map((s, si) => (
              <circle key={`h-${s.key}`} cx={hover.x} cy={y(s.mean[hover.i])} r={4.5}
                style={{ fill: s.color, stroke: SURFACE }} strokeWidth={2} />
            ))}
          </g>
        ) : null}

        {/* x axis */}
        <line x1={m.l} x2={m.l + iw} y1={m.t + plotH} y2={m.t + plotH} strokeWidth={1} style={{ stroke: AXIS }} />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const i = Math.round(f * (n - 1));
          return (
            <text key={f} x={x(i)} y={m.t + plotH + 18}
              textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="dash-axis-text">
              {fmtClock(i * sampleSeconds)}
            </text>
          );
        })}

        {/* sample-size strip: how many bouts are still running */}
        <text x={m.l - 8} y={stripTop + 10} textAnchor="end" className="dash-axis-text">n</text>
        {counts.map((c, i) => {
          if (n <= 1) return null;
          const bw = Math.max(1, iw / n);
          return (
            <rect key={i} x={x(i) - bw / 2} y={stripTop + 2 + (1 - c / maxCount) * 14}
              width={Math.max(1, bw - 0.5)} height={Math.max(1, (c / maxCount) * 14)}
              style={{ fill: MUTED }} opacity={0.55} />
          );
        })}
        <text x={m.l} y={stripTop + 30} className="dash-axis-text">
          {`bouts still running: ${totalBouts} → ${counts[n - 1] ?? 0}`}
        </text>
      </svg>
      {hover && counts[hover.i] > 0 ? (
        <div className="dash-tip" style={{
          left: `${Math.min(Math.max(hover.x + 12, 8), Math.max(8, width - 190))}px`, top: `${m.t + 6}px`,
        }}>
          <p className="dash-tip-head">{fmtClock(hover.i * sampleSeconds)}</p>
          {series.map((s) => (
            <p key={s.key} className="dash-tip-row">
              <span className="dash-key dash-key-line" style={{ background: s.color }} aria-hidden="true" />
              <span>{s.label}</span>
              <b>{yFormat(s.mean[hover.i])}</b>
            </p>
          ))}
          <p className="dash-tip-foot">{`IQR ${yFormat(series[0].lo[hover.i])}–${yFormat(series[0].hi[hover.i])} · n = ${counts[hover.i]}`}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* diverging trajectory (score margin: A minus B)                      */
/* ------------------------------------------------------------------ */

export function DivergingTrajectory(props: {
  width: number;
  mean: number[]; lo: number[]; hi: number[];
  counts: number[]; totalBouts: number; sampleSeconds: number;
  height?: number;
  fadeBelow?: number;
}) {
  const { width, mean, lo, hi, counts, totalBouts, sampleSeconds, height = 230, fadeBelow = 0.5 } = props;
  const uid = useId2();
  const n = mean.length;
  const m = { l: 46, r: 14, t: 14, b: 30 };
  const empty = n === 0;
  const ih = Math.max(60, height - m.t - m.b);
  const iw = Math.max(30, width - m.l - m.r);

  let dLo = 0, dHi = 0;
  for (let i = 0; i < n; i++) { if (counts[i] === 0) continue; dLo = Math.min(dLo, lo[i]); dHi = Math.max(dHi, hi[i]); }
  const span = Math.max(1e-6, Math.max(Math.abs(dLo), Math.abs(dHi)) * 1.12);
  const y = (v: number) => m.t + ih / 2 - (v / span) * (ih / 2);
  const x = (i: number) => m.l + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const ticks = niceTicks(-span, span, 4);
  const zero = y(0);

  let solidTo = 0;
  for (let i = 0; i < n; i++) if (counts[i] >= fadeBelow * totalBouts) solidTo = i;

  if (empty) return <p className="dash-card-note">No trajectory samples for this format.</p>;

  const pts = mean.map((v, i) => [x(i), y(v)] as [number, number]);
  const hiPts = hi.map((v, i) => [x(i), y(v)] as [number, number]);
  const loPts = lo.map((v, i) => [x(i), y(v)] as [number, number]);
  const area = `M${x(0)} ${zero}` + pts.map((p) => `L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('') + `L${x(n - 1)} ${zero}Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="dash-svg" role="img"
      aria-label="Mean score margin, A side minus B side, over simulated time">
      <defs>
        <clipPath id={`${uid}-up`}><rect x={m.l} y={m.t} width={iw} height={Math.max(0, zero - m.t)} /></clipPath>
        <clipPath id={`${uid}-dn`}><rect x={m.l} y={zero} width={iw} height={Math.max(0, m.t + ih - zero)} /></clipPath>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} strokeWidth={1} style={{ stroke: GRID }} />
          <text x={m.l - 8} y={y(t) + 4} textAnchor="end" className="dash-axis-text">{t > 0 ? `+${fmtNum(t, 0)}` : fmtNum(t, 0)}</text>
        </g>
      ))}
      <path d={bandPath(hiPts, loPts, 0, n - 1)} style={{ fill: MUTED }} opacity={0.16} />
      <path d={area} style={{ fill: POS }} opacity={0.18} clipPath={`url(#${uid}-up)`} />
      <path d={area} style={{ fill: NEG }} opacity={0.18} clipPath={`url(#${uid}-dn)`} />
      <path d={pathFrom(pts, 0, n - 1)} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        style={{ stroke: POS }} clipPath={`url(#${uid}-up)`} />
      <path d={pathFrom(pts, 0, n - 1)} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        style={{ stroke: NEG }} clipPath={`url(#${uid}-dn)`} />
      <line x1={m.l} x2={m.l + iw} y1={zero} y2={zero} strokeWidth={1} style={{ stroke: AXIS }} />
      <text x={m.l + 4} y={zero - 6} className="dash-axis-text">even</text>
      {solidTo < n - 1 ? (
        <line x1={x(solidTo)} x2={x(solidTo)} y1={m.t} y2={m.t + ih} strokeWidth={1} style={{ stroke: AXIS }} />
      ) : null}
      <circle cx={pts[solidTo]?.[0]} cy={pts[solidTo]?.[1]} r={4.5}
        style={{ fill: mean[solidTo] >= 0 ? POS : NEG, stroke: SURFACE }} strokeWidth={2} />
      <text x={Math.min(width - 6, (pts[solidTo]?.[0] ?? 0) + 8)} y={(pts[solidTo]?.[1] ?? 0) - 8}
        textAnchor={(pts[solidTo]?.[0] ?? 0) > width - 90 ? 'end' : 'start'} className="dash-value-text">
        {`${mean[solidTo] >= 0 ? '+' : ''}${fmtNum(mean[solidTo] ?? 0, 1)}`}
      </text>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const i = Math.round(f * (n - 1));
        return (
          <text key={f} x={x(i)} y={m.t + ih + 18}
            textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="dash-axis-text">
            {fmtClock(i * sampleSeconds)}
          </text>
        );
      })}
    </svg>
  );
}

/* tiny stable-id helper (React 17-safe, no useId dependency) */
let uidSeq = 0;
function useId2(): string {
  const [id] = useState(() => `dash${++uidSeq}`);
  return id;
}
