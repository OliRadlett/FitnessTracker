import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: { port: 5302, host: '127.0.0.1', fs: { allow: ['..'] } },
  // Fixtures are imported as JSON from outside src/ — keep them in one bundle
  // so the lab has no runtime fetch and every state is deterministic.
  json: { stringify: true },
});
