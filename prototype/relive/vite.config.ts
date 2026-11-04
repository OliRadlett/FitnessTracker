import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [cesium()],
  optimizeDeps: {
    // MapLibre ships its worker as a separate ESM file; Vite's dep optimizer
    // rewrites the URL and the worker 404s. Excluding it keeps the worker path
    // intact.
    exclude: ['maplibre-gl'],
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
  build: {
    target: 'es2020',
  },
});
