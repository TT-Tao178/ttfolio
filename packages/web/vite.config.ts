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
      return (
        html
          .replaceAll('%%TTFOLIO_TOKEN%%', token)
          .replaceAll('%%TTFOLIO_PORT%%', port)
          // dev 下 API 走 vite 代理（同源）；用户内容仍指向独立端口，保持 C-13 的跨源隔离
          .replaceAll('%%TTFOLIO_API_BASE%%', '')
          .replaceAll('%%TTFOLIO_CONTENT_BASE%%', contentBase)
      );
    },
  };
}

export default defineConfig(() => {
  const target = process.env['TTFOLIO_PROXY_TARGET'] ?? 'http://127.0.0.1:7717';
  const token = process.env['TTFOLIO_TOKEN'] ?? '';
  return {
    root: path.resolve(__dirname),
    plugins: [react(), injectRuntime()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      // 显式绑 IPv4 环回：Vite 默认 host='localhost' 在本机只监听 ::1，
      // 用户手输 http://127.0.0.1:5173 会"连不上"（localhost 与 127.0.0.1 两种写法都要能用）。
      // 仍只绑环回，不放 0.0.0.0，符合 C-09 的本地可达边界。
      host: '127.0.0.1',
      port: 5173,
      watch: {
        // 原子写工具的临时产物不能被 watch：某些编辑器/代理写文件时会先建
        // `<file>.<pid>.<uuid>.tmpdir/<file>.tmp`，Vite 的 FSWatcher 去 watch 这个瞬时目录会抛
        // EBUSY: resource busy or locked，**直接整进程退出**（实测把 dev 服务打挂过一次）。
        ignored: ['**/*.tmpdir/**', '**/*.tmp', '**/.*.tmpdir/**', '**/~$*'],
      },
      proxy: {
        '/api': {
          target,
          // 修复：changeOrigin:false 会把 Host 原样透传为 localhost:5173，被服务端 Host 白名单拒绝（403 非法 Host 头）
          changeOrigin: true,
          headers: { 'x-ttfolio-token': token },
        },
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 2000,
      // 拆包（第 36 轮 A4）：全量单 chunk 曾达 2.3MB 并每次构建告警。
      // 按稳定第三方库分三块，其余 node_modules 归 vendor，业务代码保持单入口
      // chunk——命中缓存且首屏并行加载；分块后每块低于告警阈值。
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            // react 块只收核心五包的精确路径：泛匹配 'react' 子串会把 @tanstack/react-*
            // 等 react 系库错分进来，与 vendor 互相引用产生 circular chunk
            if (/[\\/]node_modules[\\/](react|react-dom|react-is|react-reconciler|scheduler)[\\/]/.test(id))
              return 'react';
            if (id.includes('antd') || id.includes('@ant-design') || id.includes('rc-')) return 'antd';
            if (id.includes('codemirror') || id.includes('@uiw/react-codemirror') || id.includes('@lezer'))
              return 'codemirror';
            // 文档预览三库（第 40 轮）：仅 DocsTab 打开 Word/PDF/Excel 时才动态加载，
            // 单独成组避免被兜进 vendor 随首屏加载（pdf.worker 已自动独立 chunk）
            if (
              id.includes('pdfjs-dist') ||
              id.includes('docx-preview') ||
              /[\\/]node_modules[\\/]xlsx[\\/]/.test(id)
            )
              return 'preview';
            return 'vendor';
          },
        },
      },
    },
  };
});
