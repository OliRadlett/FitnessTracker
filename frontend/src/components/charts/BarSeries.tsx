'use client';

/**
 * BarSeries — bars around a zero baseline, for weekly change and daily load.
 * Fitted domain (chartScale), zero line, no legend, end tick always drawn.
 */
import React from 'react';
import { axisTicks, fitDomain, round, visibleTicks } from './chartScale';
import { useMeasuredWidth } from './LineSeries';

const TEXT = 12;
const AXIS = '#94a3b8';
const GRID = '#243244';

export interface BarSeriesProps {
  values: (number | null)[];
  labels: string[];
  height?: number;
  color?: string;
  negativeColor?: string;
  yFormat?: (v: number) => string;
  maxTicks?: number;
  className?: string;
}

export function BarSeries({
  values,
  labels,
  height = 150,
  color = '#3b82f6',
  negativeColor = '#ef4444',
  yFormat = (v: number) => String(Math.round(v)),
  maxTicks = 7,
  className = '',
}: BarSeriesProps) {
  const { ref, width } = useMeasuredWidth();
  const clean = values.filter((v): v is number => v != null);
  const domain = fitDomain([...clean, 0], { zero: true });

  const padL = 38;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - padB);

  const xPos = (i: number) => (values.length <= 1 ? padL + plotW / 2 : padL + (i / (values.length - 1)) * plotW);
  const yPos = (v: number) => padT + plotH - ((v - domain[0]) / (domain[1] - domain[0] || 1)) * plotH;

  const every = Math.max(1, Math.ceil(labels.length / maxTicks));
  const ticks = visibleTicks(labels.length, every, (a, b) => xPos(a) - xPos(b));
  const barW = Math.max(2, plotW / Math.max(values.length, 1) - 2);
  const zeroY = yPos(0);

  return (
    <div ref={ref} className={className}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bar chart">
        {axisTicks(domain, 3).map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={round(yPos(v))} y2={round(yPos(v))} stroke={GRID} strokeWidth={1} />
            <text x={padL - 6} y={round(yPos(v)) + 4} fill={AXIS} fontSize={TEXT} textAnchor="end" className="tabular-nums">
              {yFormat(v)}
            </text>
          </g>
        ))}

        {values.map((v, i) => {
          if (v == null) return null;
          const top = v >= 0 ? yPos(v) : zeroY;
          return (
            <rect
              key={i}
              x={round(xPos(i) - barW / 2)}
              y={round(top)}
              width={round(barW)}
              height={round(Math.abs(yPos(v) - zeroY))}
              rx={2}
              fill={v >= 0 ? color : negativeColor}
            />
          );
        })}

        <line x1={padL} x2={width - padR} y1={round(zeroY)} y2={round(zeroY)} stroke={AXIS} strokeWidth={1} />

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
      </svg>
    </div>
  );
}
