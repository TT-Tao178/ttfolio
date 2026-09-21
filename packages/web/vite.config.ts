import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(() => {
  const target = process.env['TTFOLIO_PROXY_TARGET'] ?? 'http://127.0.0.1:7717';
  const token = process.env['TTFOLIO_TOKEN'] ?? '';
  return {
    root: path.resolve(__dirname),
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') }
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: false,
          headers: { 'x-ttfolio-token': token }
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 2000
    }
  };
});
