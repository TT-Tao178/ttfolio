/** 打包桌面版用：把服务端（Fastify + 全部路由/仓储）打成单个 CJS 产物 app/server/main.cjs。
 *  better-sqlite3 是 native 模块，必须 external（随安装包以 electron ABI 的预编译产物分发）。 */
import { build } from 'esbuild';

await build({
  entryPoints: ['packages/server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'app/server/main.cjs',
  external: ['better-sqlite3'],
  sourcemap: false,
  logLevel: 'info',
  legalComments: 'none',
});
