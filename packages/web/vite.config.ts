import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * dev 模式注入运行时占位符。
 * 修复：dev 下 index.html 的 %%TTFOLIO_TOKEN%% / %%TTFOLIO_PORT%% 无人替换，
 * window.__TTFOLIO_TOKEN__ 变成字面占位符 → SSE URL 非法 → Shell 渲染抛错 → 整页白屏。
 * 只作用于 dev（apply: 'serve'）：生产构建必须保留占位符，由 server 在响应时注入真实值。
 */
function injectRuntime(): Plugin {
  return {
    name: 'ttfolio-inject-runtime',
    apply: 'serve',
    transformIndexHtml(html: string): string {
      const target = process.env['TTFOLIO_PROXY_TARGET'] ?? 'http://127.0.0.1:7717';
      let port = '7717';
      try {
        const parsed = new URL(target);
        if (parsed.port !== '') port = parsed.port;
      } catch {
        /* 目标非法时保留默认端口 */
      }
      const token = process.env['TTFOLIO_TOKEN'] ?? '';
      const contentPort = String(Number.parseInt(port, 10) + 100);
      const contentBase = `${process.env['TTFOLIO_CONTENT_ORIGIN'] ?? 'http://localhost'}:${contentPort}`;
      return html
        .replaceAll('%%TTFOLIO_TOKEN%%', token)
        .replaceAll('%%TTFOLIO_PORT%%', port)
        // dev 下 API 走 vite 代理（同源）；用户内容仍指向独立端口，保持 C-13 的跨源隔离
        .replaceAll('%%TTFOLIO_API_BASE%%', '')
        .replaceAll('%%TTFOLIO_CONTENT_BASE%%', contentBase);
    }
  };
}

export default defineConfig(() => {
  const target = process.env['TTFOLIO_PROXY_TARGET'] ?? 'http://127.0.0.1:7717';
  const token = process.env['TTFOLIO_TOKEN'] ?? '';
  return {
    root: path.resolve(__dirname),
    plugins: [react(), injectRuntime()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') }
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          // 修复：changeOrigin:false 会把 Host 原样透传为 localhost:5173，被服务端 Host 白名单拒绝（403 非法 Host 头）
          changeOrigin: true,
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
