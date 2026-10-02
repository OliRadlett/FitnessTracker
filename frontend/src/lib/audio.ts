/**
 * Spatial ride audio for the Relive viewer (next-level Phase D).
 *
 * Three synthesized voices, all driven live: wind (looped filtered noise
 * tracking speed), tire rumble (the same noise bed through a bandpass —
 * texture under the wind, not a second recording) and heartbeat thumps
 * tracking the HR strap. Browser-only (Web Audio) — the pure mapping helpers
 * below are unit-tested; the engine itself needs a real AudioContext.
 *
 * Autoplay rules shape the UX contract: the context is created on the toggle
 * gesture only, and the feature ships default-OFF behind a toolbar speaker
 * button, so no session ever gets surprise audio.
 */

/** Wind gain 0..0.25: silent crawling, full rush at a fast descent. */
export function windGainFor(speedMs: number): number {
  if (!Number.isFinite(speedMs) || speedMs <= 2) return 0;
  return Math.min(0.25, ((speedMs - 2) / 20) * 0.25);
}

/** Wind lowpass cutoff: dull rumble uphill, bright hiss at pace. */
export function windFreqFor(speedMs: number): number {
  if (!Number.isFinite(speedMs)) return 300;
  return 300 + Math.max(0, speedMs) * 40;
}

/** Seconds per heartbeat for a live HR, or null when there is no beat to play. */
export function heartPeriodFor(bpm: number | null | undefined): number | null {
  if (bpm == null || !Number.isFinite(bpm) || bpm < 30 || bpm > 220) return null;
  return 60 / bpm;
}

/** Tire-rumble gain 0..0.05: texture under the wind, never over it. */
export function rumbleGainFor(speedMs: number): number {
  if (!Number.isFinite(speedMs) || speedMs <= 3) return 0;
  return Math.min(0.05, ((speedMs - 3) / 12) * 0.05);
}

export interface RideAudio {
  /** push the current speed (call ~10 Hz — the engine smooths internally) */
  setWind(speedMs: number): void;
  /** push the current heart rate (null = no HR strap); schedules soft thumps */
  setHeart(bpm: number | null): void;
  /** suspend/resume the context (pause, hidden tab, toggle) */
  setActive(active: boolean): void;
  dispose(): void;
}

/**
 * Build the wind engine. Must be called from a user gesture (toggle click) —
 * otherwise the browser starts the context suspended and stays silent.
 * Returns null when Web Audio is unavailable instead of throwing.
 */
export function createRideAudio(): RideAudio | null {
  try {
    const Ctx = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    // 2 s of looped white noise as the raw wind bed.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    // Tire rumble reuses the same noise bed through a bandpass — a second
    // voice for the cost of two nodes, no second buffer.
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = buffer;
    rumbleSrc.loop = true;
    rumbleSrc.playbackRate.value = 0.5; // half-speed bed reads as low hum, not hiss
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'bandpass';
    rumbleFilter.frequency.value = 110;
    rumbleFilter.Q.value = 1.2;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleSrc.connect(rumbleFilter).connect(rumbleGain).connect(ctx.destination);
    rumbleSrc.start();
    // Smoothing so per-frame updates never click or zipper.
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    filter.frequency.setTargetAtTime(300, ctx.currentTime, 0.1);
    rumbleGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    // Heartbeat: soft lub-dub thumps scheduled with a short lookahead. Kept
    // deliberately quiet — it sits under the wind, never over it.
    let heartBpm: number | null = null;
    let nextBeat = 0;
    const thump = (when: number, vol: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 58;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(vol, when + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      osc.connect(g).connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.2);
    };
    const heartTimer = window.setInterval(() => {
      if (ctx.state !== 'running') return;
      const period = heartPeriodFor(heartBpm);
      if (period == null) return;
      if (nextBeat < ctx.currentTime - 1) nextBeat = ctx.currentTime + 0.1;
      while (nextBeat < ctx.currentTime + 0.6) {
        thump(nextBeat, 0.14);
        thump(nextBeat + 0.14, 0.09);
        nextBeat += period;
      }
    }, 200);
    return {
      setWind(speedMs: number) {
        if (ctx.state !== 'running') return;
        const t = ctx.currentTime;
        gain.gain.setTargetAtTime(windGainFor(speedMs), t, 0.15);
        filter.frequency.setTargetAtTime(windFreqFor(speedMs), t, 0.15);
        rumbleGain.gain.setTargetAtTime(rumbleGainFor(speedMs), t, 0.15);
      },
      setHeart(bpm: number | null) {
        heartBpm = heartPeriodFor(bpm) == null ? null : bpm;
      },
      setActive(active: boolean) {
        if (active) void ctx.resume().catch(() => {});
        else void ctx.suspend().catch(() => {});
      },
      dispose() {
        window.clearInterval(heartTimer);
        for (const s of [src, rumbleSrc]) {
          try {
            s.stop();
          } catch {
            /* already stopped */
          }
        }
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}
