import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  envDir: '..',
  plugins: [react()],
  build: { outDir: '../dist-web', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
});
