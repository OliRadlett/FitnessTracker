import { describe, it, expect } from 'vitest';
import {
  PERF_MIN_FPS,
  PERF_WARMUP_FRAMES,
  createPerfBudget,
  isSoftwareGLRenderer,
  perfNeedsDegrade,
  perfObserve,
  prefersReducedMotion,
} from '@/lib/perf';

describe('perfObserve', () => {
  it('stays silent through the warmup window', () => {
    const b = createPerfBudget();
    for (let i = 0; i < PERF_WARMUP_FRAMES - 1; i++) {
      expect(perfObserve(b, 100)).toBeNull();
    }
  });

  it('reports ~60 fps for a smooth device, once only', () => {
    const b = createPerfBudget();
    let fps: number | null = null;
    for (let i = 0; i < PERF_WARMUP_FRAMES; i++) fps = perfObserve(b, 1000 / 60);
    expect(fps).toBeCloseTo(60, 0);
    expect(perfObserve(b, 1000)).toBeNull(); // assessed — never again
  });

  it('ignores non-positive deltas', () => {
    const b = createPerfBudget();
    expect(perfObserve(b, 0)).toBeNull();
    expect(perfObserve(b, Number.NaN)).toBeNull();
    expect(b.frames).toBe(0);
  });

  it('clamps tab-switch spikes so one hitch cannot fail the verdict', () => {
    const b = createPerfBudget();
    let fps: number | null = null;
    for (let i = 0; i < PERF_WARMUP_FRAMES - 1; i++) fps = perfObserve(b, 1000 / 60);
    fps = perfObserve(b, 5000);
    expect(fps).not.toBeNull();
    expect(fps!).toBeGreaterThan(50);
  });
});

describe('prefersReducedMotion', () => {
  it('reads the OS preference and degrades safe without matchMedia', () => {
    // globalThis — never bare `window`, so this also runs outside jsdom.
    const g = globalThis as unknown as Record<string, unknown>;
    const createdWindow = !('window' in g);
    if (createdWindow) g.window = {};
    const w = g.window as Record<string, unknown>;
    const prev = w.matchMedia;
    try {
      w.matchMedia = () => ({ matches: true }) as MediaQueryList;
      expect(prefersReducedMotion()).toBe(true);
      w.matchMedia = () => ({ matches: false }) as MediaQueryList;
      expect(prefersReducedMotion()).toBe(false);
      delete w.matchMedia;
      expect(prefersReducedMotion()).toBe(false);
    } finally {
      if (prev === undefined) delete w.matchMedia;
      else w.matchMedia = prev;
      if (createdWindow) delete g.window;
    }
  });
});

describe('isSoftwareGLRenderer', () => {
  it('catches software rasterizers without touching real GPUs', () => {
    expect(isSoftwareGLRenderer('WebKit WebGL SwiftShader Device')).toBe(true);
    expect(isSoftwareGLRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe(true);
    expect(isSoftwareGLRenderer('llvmpipe (LLVM 15, 256 bits)')).toBe(true);
    expect(isSoftwareGLRenderer('WebGL Basic Render Driver')).toBe(true);
    expect(isSoftwareGLRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070)')).toBe(false);
    expect(isSoftwareGLRenderer('Apple M1 Pro')).toBe(false);
    expect(isSoftwareGLRenderer('Mali-G78')).toBe(false);
    expect(isSoftwareGLRenderer(null)).toBe(false);
    expect(isSoftwareGLRenderer(undefined)).toBe(false);
    expect(isSoftwareGLRenderer('')).toBe(false);
  });
});

describe('perfNeedsDegrade', () => {
  it('trips below the bar only', () => {
    expect(perfNeedsDegrade(PERF_MIN_FPS - 1)).toBe(true);
    expect(perfNeedsDegrade(PERF_MIN_FPS)).toBe(false);
    expect(perfNeedsDegrade(120)).toBe(false);
  });
});
