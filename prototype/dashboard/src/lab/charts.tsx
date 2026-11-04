import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DayCell, LoadPoint } from './fixture';

/** House viz colours: CTL green, ATL red, TSB blue — the legend the app already uses. */
const C = {
  ctl: 'rgb(16 185 129)',
  atl: 'rgb(239 68 68)',
  tsb: 'rgb(56 189 248)',
  grid: 'rgba(255,255,255,0.06)',
  axis: 'rgb(148 163 184)',
};

const axisProps = {
  tick: { fill: C.axis, fontSize: 10 },
  stroke: 'transparent',
  tickLine: false,
  // Let Recharts thin ticks on a narrow viewport instead of letting date labels collide.
  minTickGap: 18,
} as const;

const round = (v: number) => Math.round(v).toString();

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-surface-light bg-background/95 px-2 py-1.5 text-[11px] shadow-lg">
      <div className="mb-1 text-muted">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto tabular-nums text-foreground">
            {typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Form over the last `days` days. Animation off: a screenshot must catch the series. */
export function FormChart({ points, days = 90 }: { points: LoadPoint[]; days?: number }) {
  const data = points.slice(-days);
  const tsbMin = Math.min(...data.map((d) => d.tsb), 0);
  const tsbMax = Math.max(...data.map((d) => d.tsb), 0);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis
          dataKey="date"
          {...axisProps}
          interval={Math.max(0, Math.floor(data.length / 5) - 1)}
          tickFormatter={(d: string) => d.slice(5).replace('-', '/')}
        />
        <YAxis yAxisId="load" {...axisProps} width={30} tickFormatter={round} />
        <YAxis
          yAxisId="tsb"
          orientation="right"
          {...axisProps}
          width={36}
          domain={[Math.floor(tsbMin - 2), Math.ceil(tsbMax + 2)]}
          tickFormatter={round}
        />
        <ReferenceLine yAxisId="tsb" y={0} stroke="rgba(255,255,255,0.16)" />
        <Tooltip content={<TooltipBox />} />
        <Line
          yAxisId="load"
          type="monotone"
          dataKey="ctl"
          name="Fitness (CTL)"
          stroke={C.ctl}
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="load"
          type="monotone"
          dataKey="atl"
          name="Fatigue (ATL)"
          stroke={C.atl}
          strokeWidth={1.4}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="tsb"
          type="monotone"
          dataKey="tsb"
          name="Form (TSB)"
          stroke={C.tsb}
          strokeWidth={1.4}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Weekly TSS. The bar chart that renders axes and no marks in the current page. */
export function WeeklyTssBars({ labels, values }: { labels: string[]; values: number[] }) {
  const data = labels.map((l, i) => ({
    week: l.slice(5).replace('-', '/'),
    tss: Math.round(values[i] ?? 0),
  }));
  const max = Math.max(...data.map((d) => d.tss), 1);
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="week" {...axisProps} />
        <YAxis {...axisProps} width={34} domain={[0, Math.ceil(max / 50) * 50]} tickFormatter={round} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="tss" name="TSS" fill={C.ctl} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** HRV with a fitted domain, on its own card. */
export function HrvChart({ labels, values }: { labels: string[]; values: (number | null)[] }) {
  const start = Math.max(0, labels.length - 60);
  const data = labels.slice(start).map((l, i) => ({
    date: l.slice(5).replace('-', '/'),
    hrv: values[start + i] ?? null,
  }));
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="hrvFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.tsb} stopOpacity={0.28} />
            <stop offset="100%" stopColor={C.tsb} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps} interval={Math.max(0, Math.floor(data.length / 4) - 1)} />
        <YAxis {...axisProps} width={32} domain={['dataMin - 5', 'dataMax + 5']} tickFormatter={round} />
        <Tooltip content={<TooltipBox />} />
        <Area
          type="monotone"
          dataKey="hrv"
          name="HRV (ms)"
          stroke={C.tsb}
          strokeWidth={1.4}
          fill="url(#hrvFill)"
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Monthly TSS — the year record, as bars with a fitted domain. */
export function MonthBars({
  rows,
}: {
  rows: { month: string; total_tss: number }[];
}) {
  const data = rows.map((r) => ({
    month: r.month.slice(5) === '01' ? r.month.slice(2, 4) : r.month.slice(5),
    tss: Math.round(r.total_tss),
  }));
  const max = Math.max(...data.map((d) => d.tss), 1);
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} width={36} domain={[0, Math.ceil(max / 200) * 200]} tickFormatter={round} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="tss" name="TSS" fill={C.ctl} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Sparkline ────────────────────────────────────────────────────────────────
   Hand-drawn so it cannot silently render an empty path: the intrinsic width and
   a computed `d` are the only inputs, and there is no library between. */

export function Sparkline({
  values,
  color = C.ctl,
  width = 96,
  height = 26,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 3) - 1.5;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

/* ── The cross-domain band ────────────────────────────────────────────────────
   One row per domain, one column per day, one shared x. Two SVGs on the same
   viewBox so the columns line up exactly; the line uses a non-scaling stroke so
   the responsive stretch does not fatten it. */

const COL = 100;

export function DomainStrip({
  cells,
  height = 44,
  showLabels = false,
  marks,
}: {
  cells: DayCell[];
  height?: number;
  showLabels?: boolean;
  /** Endpoint that says a day carried a session, used for the activity tick row. */
  marks?: Record<string, 'lift' | 'ride'>;
}) {
  const n = cells.length;
  const slot = COL / n;
  const gap = Math.max(0.4, slot * 0.22);
  const bw = Math.max(0.4, slot - gap * 2);

  const maxTss = Math.max(...cells.map((c) => c.tss), 1);
  const withHrv = cells.map((c) => c.hrv).filter((v): v is number => typeof v === 'number');
  const hrvLo = withHrv.length ? Math.min(...withHrv) : 30;
  const hrvHi = withHrv.length ? Math.max(...withHrv) : 70;
  // Pad the domain by 18% so the line breathes instead of hugging its own baseline.
  const pad = Math.max(2, (hrvHi - hrvLo) * 0.18);
  const hrvMin = hrvLo - pad;
  const hrvMax = hrvHi + pad;
  const hrvSpan = hrvMax - hrvMin || 1;
  const HRV_H = 30;
  const top = 4;
  const bottom = HRV_H - 4;

  const hrvPoints = cells
    .map((c, i) => {
      if (typeof c.hrv !== 'number') return null;
      const x = i * slot + slot / 2;
      const y = bottom - ((c.hrv - hrvMin) / hrvSpan) * (bottom - top);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .filter(Boolean)
    .join(' ');

  const MARK_H = 7;

  return (
    <div>
      {/* daily load */}
      <svg
        viewBox={`0 0 ${COL} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Daily training load and HRV for the window"
      >
        <line x1={0} y1={height - 0.5} x2={COL} y2={height - 0.5} stroke="rgba(255,255,255,0.10)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {cells.map((c, i) => {
          const h = c.tss > 0 ? Math.max(2.5, (c.tss / maxTss) * (height - 3)) : 1.2;
          return (
            <rect
              key={c.date}
              x={i * slot + gap}
              y={height - h}
              width={bw}
              height={h}
              rx={0.8}
              fill={c.tss > 0 ? C.ctl : 'rgba(255,255,255,0.10)'}
            >
              <title>{`${c.date} · ${Math.round(c.tss)} TSS`}</title>
            </rect>
          );
        })}
      </svg>

      {/* recovery */}
      <svg
        viewBox={`0 0 ${COL} ${HRV_H}`}
        preserveAspectRatio="none"
        className="mt-0.5 w-full"
        style={{ height: HRV_H }}
        aria-hidden
      >
        <line x1={0} y1={HRV_H - 0.5} x2={COL} y2={HRV_H - 0.5} stroke="rgba(255,255,255,0.06)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {hrvPoints && (
          <polyline
            points={hrvPoints}
            fill="none"
            stroke={C.tsb}
            strokeWidth={1.3}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        )}
        {cells.map((c, i) =>
          typeof c.hrv === 'number' ? (
            <circle
              key={c.date}
              cx={i * slot + slot / 2}
              cy={bottom - ((c.hrv - hrvMin) / hrvSpan) * (bottom - top)}
              r={0.6}
              fill={C.tsb}
            >
              <title>{`${c.date} · HRV ${Math.round(c.hrv)} ms`}</title>
            </circle>
          ) : null,
        )}
      </svg>

      {/* what kind of session the day carried — the only per-day proof of the join */}
      {marks && (
        <svg
          viewBox={`0 0 ${COL} ${MARK_H}`}
          preserveAspectRatio="none"
          className="mt-0.5 w-full"
          style={{ height: MARK_H }}
          aria-hidden
        >
          {cells.map((c, i) => {
            const m = marks[c.date];
            if (!m) return null;
            return (
              <rect
                key={c.date}
                x={i * slot + slot / 2 - Math.max(0.6, slot * 0.16)}
                y={1}
                width={Math.max(1.2, slot * 0.32)}
                height={MARK_H - 2}
                rx={0.6}
                fill={m === 'lift' ? 'rgb(167 139 250)' : C.tsb}
              >
                <title>{`${c.date} · ${m}`}</title>
              </rect>
            );
          })}
        </svg>
      )}

      {showLabels && (
        <div className="mt-1.5 flex">
          {cells.map((c, i) => (
            <div key={c.date} className="min-w-0 flex-1 text-center text-[10px] leading-none text-muted">
              {i % 2 === 0 ? c.date.slice(8) : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
