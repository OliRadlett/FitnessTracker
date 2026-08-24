import '@testing-library/jest-dom/vitest';

// jsdom lacks ResizeObserver, which Recharts' ResponsiveContainer requires.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;
