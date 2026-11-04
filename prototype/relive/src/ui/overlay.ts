import type { Ride, PoseName } from '../data/ride';
import {
  POSES,
  formatClock,
  formatDate,
  formatDistance,
  formatDuration,
} from '../data/ride';
import { createStoryPanel } from './story';

export interface UICallbacks {
  onPose(pose: PoseName): void;
  onPlayToggle(): void;
  onFollowToggle(): void;
  onGhostToggle(): void;
  onGhostSelect(id: string | null): void;
  onSeek(t: number): void;
  onSpeedChange(speed: number): void;
}

export interface UI {
  setTime(t: number, index: number): void;
  setPlaying(playing: boolean): void;
  setFollow(enabled: boolean): void;
  setGhost(
    enabled: boolean,
    deltaM: number,
    ghostId?: string | null,
    label?: string | null,
  ): void;
  setPose(pose: PoseName): void;
  setDebug(text: string): void;
  toggleDebug(): void;
}

export function createUI(
  root: HTMLElement,
  ride: Ride,
  callbacks: UICallbacks,
  ghostOptions: { id: string; label: string }[] = [],
): UI {
  const weather = ride.weather;
  const weatherLine = [
    weather.conditions ?? '—',
    weather.temperature_c != null ? `${weather.temperature_c.toFixed(1)}°C` : null,
    weather.wind_speed_kmh != null ? `wind ${weather.wind_speed_kmh.toFixed(1)} km/h` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const t0 = ride.streams.t[0];
  const t1 = ride.streams.t[ride.streams.t.length - 1];
  const eyebrow = ride.id.startsWith('arthurs')
    ? "RELIVE · ARTHUR'S SEAT"
    : 'RELIVE · LAKE GENEVA';
  const ghostTitle = ride.id.startsWith('arthurs')
    ? 'Ghosts from the production route history'
    : 'Synthetic ghost: 15 s lead';

  root.innerHTML = `
    <div class="ui">
      <div class="title-card">
        <div class="eyebrow">${eyebrow}</div>
        <h1>${ride.name}</h1>
        <div class="meta">${formatDate(ride.date)} · ${formatDistance(ride.stats.distanceM)} · ${formatDuration(ride.stats.movingS)}</div>
        <div class="weather">${weatherLine}</div>
      </div>

      <div class="hint">drag to explore · scroll to zoom · right-drag to rotate · 1–6 presets · P play</div>

      <div class="bottom-dock">
        <div id="story"></div>
        <div class="preset-bar">
          ${POSES.map(
            (p) =>
              `<button class="preset" data-pose="${p.id}">${ride.poseLabels?.[p.id] ?? p.label}</button>`,
          ).join('')}
          <span class="dock-sep"></span>
          <button class="play" data-action="play">Play</button>
          <button class="follow" data-action="follow">Follow</button>
          ${
            ghostOptions.length > 0
              ? `<select class="ghost-picker" aria-label="Ghost" title="${ghostTitle}">
                   <option value="">Ghost: off</option>
                   ${ghostOptions
                     .map(
                       (g) =>
                         `<option value="${g.id}">Ghost: ${g.label}</option>`,
                     )
                     .join('')}
                 </select>`
              : `<button class="ghost" data-action="ghost" title="${ghostTitle}">Ghost</button>`
          }
          <button class="data-toggle active" data-action="data">Data</button>
          <select class="speed" aria-label="Playback speed">
            <option value="60">60×</option>
            <option value="120" selected>120×</option>
            <option value="300">300×</option>
          </select>
        </div>
        <div class="timeline">
          <input id="seek" type="range" min="${t0}" max="${t1}" step="1" value="${t0}" />
          <div class="timeline-meta">
            <span id="clock">${formatClock(t0)}</span>
            <span>${formatDistance(ride.stats.distanceM)} loop</span>
          </div>
        </div>
      </div>

      <div class="telemetry">
        <div class="telemetry-row"><span class="k">SPEED</span><span id="speed" class="v">—</span></div>
        <div class="telemetry-row"><span class="k">HEART</span><span id="hr" class="v">—</span></div>
        <div class="telemetry-row"><span class="k">GRADE</span><span id="grade" class="v">—</span></div>
        <div class="telemetry-row"><span class="k">DIST</span><span id="dist" class="v">—</span></div>
        <div class="telemetry-row"><span class="k">GHOST</span><span id="ghost" class="v">off</span></div>
      </div>

      <div class="debug" hidden></div>
    </div>
  `;

  const seek = root.querySelector<HTMLInputElement>('#seek')!;
  const clock = root.querySelector<HTMLElement>('#clock')!;
  const speed = root.querySelector<HTMLElement>('#speed')!;
  const hr = root.querySelector<HTMLElement>('#hr')!;
  const grade = root.querySelector<HTMLElement>('#grade')!;
  const dist = root.querySelector<HTMLElement>('#dist')!;
  const ghostValue = root.querySelector<HTMLElement>('#ghost')!;
  const play = root.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  const follow = root.querySelector<HTMLButtonElement>('[data-action="follow"]')!;
  const ghostToggle = root.querySelector<HTMLButtonElement>('[data-action="ghost"]');
  const ghostSelect = root.querySelector<HTMLSelectElement>('.ghost-picker');
  const dataToggle = root.querySelector<HTMLButtonElement>('[data-action="data"]')!;
  const speedSelect = root.querySelector<HTMLSelectElement>('.speed')!;
  const debug = root.querySelector<HTMLElement>('.debug')!;
  const story = createStoryPanel(root.querySelector<HTMLElement>('#story')!, ride, {
    onSeek: callbacks.onSeek,
  });

  root.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((button) => {
    button.addEventListener('click', () => {
      callbacks.onPose(button.dataset.pose as PoseName);
    });
  });

  play.addEventListener('click', () => callbacks.onPlayToggle());
  follow.addEventListener('click', () => callbacks.onFollowToggle());
  ghostToggle?.addEventListener('click', () => callbacks.onGhostToggle());
  ghostSelect?.addEventListener('change', () => {
    callbacks.onGhostSelect(ghostSelect.value || null);
  });
  dataToggle.addEventListener('click', () => {
    story.toggle();
    dataToggle.classList.toggle('active');
  });

  speedSelect.addEventListener('change', () => {
    callbacks.onSpeedChange(Number(speedSelect.value));
  });

  let dragging = false;
  seek.addEventListener('pointerdown', () => {
    dragging = true;
  });
  seek.addEventListener('pointerup', () => {
    dragging = false;
  });
  seek.addEventListener('input', () => {
    callbacks.onSeek(Number(seek.value));
  });

  return {
    setTime(t: number, index: number) {
      if (!dragging) seek.value = String(Math.round(t));
      clock.textContent = formatClock(t);
      const streams = ride.streams;
      speed.textContent = `${(streams.v[index] * 3.6).toFixed(1)} km/h`;
      hr.textContent = `${Math.round(streams.hr[index])} bpm`;
      const g = streams.grade[index];
      grade.textContent = `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`;
      dist.textContent = formatDistance(streams.d[index]);
      story.setTime(index);
    },
    setPlaying(playing: boolean) {
      play.textContent = playing ? 'Pause' : 'Play';
    },
    setFollow(enabled: boolean) {
      follow.classList.toggle('active', enabled);
    },
    setGhost(
      enabled: boolean,
      deltaM: number,
      ghostId?: string | null,
      label?: string | null,
    ) {
      ghostToggle?.classList.toggle('active', enabled);
      if (ghostSelect) ghostSelect.value = enabled ? ghostId ?? '' : '';
      ghostValue.classList.toggle('ghost-ahead', enabled && deltaM > 0);
      ghostValue.classList.toggle('ghost-behind', enabled && deltaM < 0);
      if (!enabled) {
        ghostValue.textContent = 'off';
        return;
      }
      const abs = Math.abs(deltaM);
      const text =
        abs >= 1000 ? `${(abs / 1000).toFixed(1)} km` : `${Math.round(abs)} m`;
      const prefix = label ? `${label} · ` : '';
      ghostValue.textContent = `${prefix}${deltaM >= 0 ? '+' : '−'}${text}`;
    },
    setPose(pose: PoseName) {
      root.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((button) => {
        button.classList.toggle('active', button.dataset.pose === pose);
      });
    },
    setDebug(text: string) {
      debug.textContent = text;
    },
    toggleDebug() {
      debug.hidden = !debug.hidden;
    },
  };
}
