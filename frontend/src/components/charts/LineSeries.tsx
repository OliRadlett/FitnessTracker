'use client';

/**
 * LineSeries — a labelled line chart with no legend and no brush.
 *
 * Same job as `Chart`'s line case, three deliberate differences:
 *  - the y-domain is fitted (chartScale.fitDomain), not derived from the data;
 *  - the legend is not drawn at all: the last point carries its value, so the
 *    reader does not have to match a colour to a name;
 *  - x ticks are culled against the measured width and the end tick always wins.
 *
 * Used by the cycling page's Form and Power modes; deliberately page-local until
 * a second consumer wants it.
 */
import React from 'react';
import { axisTicks, fitDomain, round, visibleTicks, type Series } from './chartScale';

const TEXT = 12;
const AXIS = '#94a3b8';
const GRID = '#243244';

/** Measure the container so the SVG can lay out at real pixel width. */
export function useMeasuredWidth(fallback = 720) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(fallback);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export interface LineSeriesProps {
  series: Series[];
  labels: string[];
  height?: number;
  /** Numeric x for each point (e.g. log seconds) — omit for an even category axis. */
  xAt?: number[];
  yFormat?: (v: number) => string;
  /** Anchor the y-domain at zero (loads, counts) instead of padding below. */
  zeroAxis?: boolean;
  /** Label the last value of each series at the right edge (the legend stand-in). */
  endLabels?: boolean;
  refY?: { value: number; label?: string; color?: string };
  yTitle?: string;
  maxTicks?: number;
  className?: string;
}

export function LineSeries({
  series,
  labels,
  height = 220,
  xAt,
  yFormat = (v: number) => String(Math.round(v)),
  zeroAxis = false,
  endLabels = true,
  refY,
  yTitle,
  maxTicks = 7,
  className = '',
}: LineSeriesProps) {
  const { ref, width } = useMeasuredWidth();
  const values = series.flatMap((s) => s.points.map((p) => p.y)).filter((v): v is number => v != null);
  const domain = fitDomain([...values, ...(refY ? [refY.value] : [])], { zero: zeroAxis });

  const padL = 38;
  const padR = endLabels ? 66 : refY?.label ? 78 : 10;
  const padT = 10;
  const padB = 24;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);

  const xPos = (i: number) => {
    if (labels.length <= 1) return padL + plotW / 2;
    if (xAt && xAt.length === labels.length) {
      const lo = Math.min(...xAt);
      const hi = Math.max(...xAt);
      return padL + ((xAt[i] - lo) / (hi - lo || 1)) * plotW;
    }
    return padL + (i / (labels.length - 1)) * plotW;
  };
  const yPos = (v: number) => padT + plotH - ((v - domain[0]) / (domain[1] - domain[0] || 1)) * plotH;

  const fitTicks = Math.max(2, Math.floor(plotW / 62));
  const every = Math.max(1, Math.ceil(labels.length / Math.min(maxTicks, fitTicks)));
  const ticks = visibleTicks(labels.length, every, (a, b) => xPos(a) - xPos(b));

  return (
    <div ref={ref} className={className}>
      {yTitle && <p className="mb-1 text-[12px] text-muted">{yTitle}</p>}
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={yTitle ?? 'Line chart'}>
        {axisTicks(domain).map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={round(yPos(v))} y2={round(yPos(v))} stroke={GRID} strokeWidth={1} />
            <text x={padL - 6} y={round(yPos(v)) + 4} fill={AXIS} fontSize={TEXT} textAnchor="end" className="tabular-nums">
              {yFormat(v)}
            </text>
          </g>
        ))}

        {refY && (
          <g>
            <line
              x1={padL}
              x2={width - padR}
              y1={round(yPos(refY.value))}
              y2={round(yPos(refY.value))}
              stroke={refY.color ?? AXIS}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            {refY.label && (
              <text x={width - padR + 4} y={round(yPos(refY.value)) + 4} fill={refY.color ?? AXIS} fontSize={TEXT}>
                {refY.label}
              </text>
            )}
          </g>
        )}

        {ticks.map((i) => (
          <text
            key={`${labels[i]}-${i}`}
            x={round(xPos(i))}
            y={height - 6}
            fill={AXIS}
            fontSize={TEXT}
            textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
          >
            {labels[i]}
          </text>
        ))}

        {series.map((s) => {
          const d = s.points
            .map((p, i) => {
              if (p.y == null) return null;
              const prev = s.points[i - 1];
              return `${i === 0 || !prev || prev.y == null ? 'M' : 'L'}${round(xPos(i))} ${round(yPos(p.y))}`;
            })
            .filter(Boolean)
            .join(' ');
          return (
            <path
              key={s.name}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dashed ? '4 3' : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* End labels: the legend's replacement. Kept apart so two series that
            finish at the same value do not overprint each other. */}
        {endLabels &&
          (() => {
            const used: number[] = [];
            return series.map((s) => {
              const lastIdx = [...s.points].reverse().findIndex((p) => p.y != null);
              if (lastIdx === -1) return null;
              const index = s.points.length - 1 - lastIdx;
              const value = s.points[index].y as number;
              let labelY = yPos(value);
              while (used.some((y) => Math.abs(y - labelY) < 13)) labelY += 13;
              used.push(labelY);
              return (
                <g key={`${s.name}-end`}>
                  <circle cx={round(xPos(index))} cy={round(yPos(value))} r={2.6} fill={s.color} />
                  <text x={round(xPos(index)) + 6} y={round(labelY) + 4} fill={s.color} fontSize={TEXT} className="tabular-nums">
                    {yFormat(value)}
                  </text>
                </g>
              );
            });
          })()}
      </svg>
    </div>
  );
}
