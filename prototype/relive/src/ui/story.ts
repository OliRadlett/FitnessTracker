import type { Ride, RideHighlight } from '../data/ride';
import { timeAtDistance } from '../data/ride';

export interface StoryCallbacks {
  onSeek(t: number): void;
}

export interface StoryPanel {
  setTime(index: number): void;
  toggle(): void;
}

const PROFILE_W = 900;
const PROFILE_H = 88;
const SPARK_W = 300;
const SPARK_H = 34;

function linePath(
  ride: Ride,
  values: number[],
  min: number,
  max: number,
  width: number,
  height: number,
  step: number,
  pad = 4,
): string {
  const maxD = ride.streams.d[ride.streams.d.length - 1] || 1;
  const range = max - min || 1;
  let path = '';
  let first = true;
  for (let i = 0; i < ride.streams.d.length; i += step) {
    const x = (ride.streams.d[i] / maxD) * width;
    const y = height - pad - ((values[i] - min) / range) * (height - pad * 2);
    path += `${first ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    first = false;
  }
  return path;
}

function markerX(ride: Ride, highlight: RideHighlight): number | null {
  const idx = highlight.startIdx ?? highlight.idx;
  if (idx == null) return null;
  const maxD = ride.streams.d[ride.streams.d.length - 1] || 1;
  return (ride.streams.d[idx] / maxD) * PROFILE_W;
}

function chapterButton(
  ride: Ride,
  label: string,
  highlight: RideHighlight,
  className: string,
): string {
  const idx = highlight.startIdx ?? highlight.idx;
  if (idx == null) return '';
  const t = ride.streams.t[idx];
  return `<button class="chapter ${className}" data-chapter-time="${t}">${label}</button>`;
}

export function createStoryPanel(
  root: HTMLElement,
  ride: Ride,
  callbacks: StoryCallbacks,
): StoryPanel {
  const n = ride.streams.d.length;
  const step = Math.max(1, Math.ceil(n / 280));
  const alt = ride.streams.alt;
  const hr = ride.streams.hr;
  const v = ride.streams.v;
  const grade = ride.streams.grade;
  const minAlt = Math.min(...alt);
  const maxAlt = Math.max(...alt);
  const minHr = Math.min(...hr);
  const maxHr = Math.max(...hr);
  const minV = Math.min(...v);
  const maxV = Math.max(...v);
  const maxAbsGrade = Math.max(2, ...grade.map((g) => Math.abs(g)));

  const altLine = linePath(ride, alt, minAlt, maxAlt, PROFILE_W, PROFILE_H, step, 6);
  const altArea = `${altLine} L${PROFILE_W},${PROFILE_H} L0,${PROFILE_H} Z`;
  const hrLine = linePath(ride, hr, minHr, maxHr, SPARK_W, SPARK_H, step, 4);
  const vLine = linePath(ride, v, minV, maxV, SPARK_W, SPARK_H, step, 4);
  const gradeLine = linePath(
    ride,
    grade.map((g) => g + maxAbsGrade),
    0,
    maxAbsGrade * 2,
    SPARK_W,
    SPARK_H,
    step,
    4,
  );

  const markers = [
    ['climb', ride.highlights.climb],
    ['descent', ride.highlights.descent],
    ['fastest', ride.highlights.fastestKm],
    ['high', ride.highlights.highest],
  ] as const;
  const markerSvg = markers
    .map(([kind, h]) => {
      const x = markerX(ride, h);
      if (x == null) return '';
      return `<line class="story-marker story-marker-${kind}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="4" y2="${PROFILE_H - 4}" />`;
    })
    .join('');

  const climb = ride.highlights.climb;
  const descent = ride.highlights.descent;
  const fastest = ride.highlights.fastestKm;
  const highest = ride.highlights.highest;
  const chapters = [
    chapterButton(
      ride,
      `Climb ${climb.gradePct?.toFixed(1) ?? '—'}%`,
      climb,
      'chapter-climb',
    ),
    chapterButton(
      ride,
      `Descent ${Math.abs(descent.gradePct ?? 0).toFixed(1)}%`,
      descent,
      'chapter-descent',
    ),
    chapterButton(
      ride,
      `Fastest km ${fastest.speedKmh?.toFixed(1) ?? '—'} km/h`,
      fastest,
      'chapter-fastest',
    ),
    chapterButton(
      ride,
      `High point ${highest.altM?.toFixed(0) ?? '—'} m`,
      highest,
      'chapter-high',
    ),
  ]
    .filter(Boolean)
    .join('');

  root.innerHTML = `
    <div class="story-panel">
      <div class="story-head">
        <div class="chapters">${chapters}</div>
        <div class="story-readout" id="story-readout">—</div>
      </div>
      <div class="story-track" id="story-track">
        <svg class="story-profile" viewBox="0 0 ${PROFILE_W} ${PROFILE_H}" preserveAspectRatio="none" aria-label="Elevation profile">
          <path class="story-profile-area" d="${altArea}" />
          <path class="story-profile-line" d="${altLine}" />
          ${markerSvg}
        </svg>
        <div class="story-sparklines">
          <div class="spark"><span class="spark-k">HR</span><svg viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none"><path class="spark-line spark-hr" d="${hrLine}" /></svg></div>
          <div class="spark"><span class="spark-k">SPEED</span><svg viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none"><path class="spark-line spark-speed" d="${vLine}" /></svg></div>
          <div class="spark"><span class="spark-k">GRADE</span><svg viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none"><path class="spark-line spark-grade" d="${gradeLine}" /></svg></div>
        </div>
        <div class="story-playhead" id="story-playhead"></div>
      </div>
    </div>
  `;

  const panel = root.querySelector<HTMLElement>('.story-panel')!;
  const track = root.querySelector<HTMLElement>('#story-track')!;
  const playhead = root.querySelector<HTMLElement>('#story-playhead')!;
  const readout = root.querySelector<HTMLElement>('#story-readout')!;
  const maxD = ride.streams.d[n - 1] || 1;

  const seekFromEvent = (event: PointerEvent) => {
    const rect = track.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const d = (x / rect.width) * maxD;
    callbacks.onSeek(timeAtDistance(ride, d));
  };

  let dragging = false;
  track.addEventListener('pointerdown', (event) => {
    dragging = true;
    track.setPointerCapture(event.pointerId);
    seekFromEvent(event);
  });
  track.addEventListener('pointermove', (event) => {
    if (dragging) seekFromEvent(event);
  });
  track.addEventListener('pointerup', () => {
    dragging = false;
  });
  track.addEventListener('pointercancel', () => {
    dragging = false;
  });

  root.querySelectorAll<HTMLButtonElement>('[data-chapter-time]').forEach((button) => {
    button.addEventListener('click', () => {
      callbacks.onSeek(Number(button.dataset.chapterTime));
    });
  });

  return {
    setTime(index: number) {
      const i = Math.max(0, Math.min(n - 1, index));
      const pct = (ride.streams.d[i] / maxD) * 100;
      playhead.style.left = `${pct}%`;
      readout.textContent = [
        `${Math.round(ride.streams.alt[i])} m`,
        `${Math.round(ride.streams.hr[i])} bpm`,
        `${(ride.streams.v[i] * 3.6).toFixed(1)} km/h`,
        `${ride.streams.grade[i] >= 0 ? '+' : ''}${ride.streams.grade[i].toFixed(1)}%`,
      ].join(' · ');
    },
    toggle() {
      panel.classList.toggle('collapsed');
    },
  };
}
