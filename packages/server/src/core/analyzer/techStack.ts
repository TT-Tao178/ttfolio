/** 技术栈标签提取（FR-3.4）：只读解析 ≤512KB 清单文件，限制数量与长度。 */
import * as fsx from '../fsx.js';
import { MAX_MANIFEST_BYTES } from '@ttfolio/shared';

const MAX_TAGS = 10;
const MAX_TAG_LEN = 24;

const NPM_FRAMEWORK_MAP: Record<string, string> = {
  react: 'React', 'react-dom': 'React', next: 'Next.js', vue: 'Vue', 'vue-router': 'Vue',
  nuxt: 'Nuxt', '@angular/core': 'Angular', svelte: 'Svelte', '@sveltejs/kit': 'SvelteKit',
  vite: 'Vite', webpack: 'Webpack', rollup: 'Rollup', esbuild: 'esbuild', turbo: 'Turborepo',
  typescript: 'TypeScript', tailwindcss: 'Tailwind CSS', 'ant-design-vue': 'Ant Design Vue',
  antd: 'Ant Design', 'element-plus': 'Element Plus', '@mui/material': 'MUI',
  express: 'Express', fastify: 'Fastify', koa: 'Koa', nestjs: 'NestJS', '@nestjs/core': 'NestJS',
  hapi: 'Hapi', electron: 'Electron', 'react-native': 'React Native',
  'better-sqlite3': 'SQLite', prisma: 'Prisma', typeorm: 'TypeORM', sequelize: 'Sequelize',
  jest: 'Jest', vitest: 'Vitest', mocha: 'Mocha', playwright: 'Playwright',
  '@playwright/test': 'Playwright', cypress: 'Cypress', eslint: 'ESLint', axios: 'axios',
  'socket.io': 'Socket.IO', ws: 'WebSocket', tauri: 'Tauri'
};

const PY_MAP: Record<string, string> = {
  fastapi: 'FastAPI', flask: 'Flask', django: 'Django', starlette: 'Starlette',
  sqlalchemy: 'SQLAlchemy', pydantic: 'Pydantic', pytest: 'pytest', celery: 'Celery',
  numpy: 'NumPy', pandas: 'pandas', torch: 'PyTorch', tensorflow: 'TensorFlow',
  'scikit-learn': 'scikit-learn', requests: 'requests', uvicorn: 'uvicorn', gunicorn: 'gunicorn'
};

const GO_MAP: Record<string, string> = {
  'gin-gonic/gin': 'Gin', 'labstack/echo': 'Echo', 'gofiber/fiber': 'Fiber',
  'gorilla/mux': 'Gorilla', 'go-zero': 'go-zero', gorm: 'GORM', cobra: 'Cobra'
};

const RUST_MAP: Record<string, string> = {
  axum: 'axum', actix: 'actix', actix_web: 'actix-web', rocket: 'Rocket', warp: 'Warp',
  serde: 'serde', tokio: 'tokio', sqlx: 'sqlx', diesel: 'Diesel', clap: 'clap', tauri: 'Tauri'
};

const JAVA_HINTS: Array<[RegExp, string]> = [
  [/spring-boot|springframework/, 'Spring'],
  [/mybatis/, 'MyBatis'],
  [/hibernate/, 'Hibernate'],
  [/netty/, 'Netty'],
  [/dubbo/, 'Dubbo'],
  [/log4j|logback|slf4j/, '日志组件'],
  [/junit/, 'JUnit']
];

function addTag(tags: Set<string>, tag: string): void {
  const t = tag.slice(0, MAX_TAG_LEN);
  if (t !== '') tags.add(t);
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function depsOf(json: Record<string, unknown>, key: string): string[] {
  const deps = json[key];
  if (typeof deps !== 'object' || deps === null) return [];
  return Object.keys(deps as Record<string, unknown>);
}

/** 从清单文件内容提取标签。返回 null 表示该文件不是有效清单。 */
export function extractFromManifest(relPath: string, text: string, size: number): string[] | null {
  if (size > MAX_MANIFEST_BYTES) return null;
  const lower = relPath.replace(/\\/g, '/').toLowerCase();
  const fileName = lower.split('/').pop() ?? '';
  const tags = new Set<string>();

  if (fileName === 'package.json') {
    const json = parseJsonSafe(text);
    if (json === null) return [];
    for (const dep of [...depsOf(json, 'dependencies'), ...depsOf(json, 'devDependencies')]) {
      const base = dep.split('/').pop() ?? dep;
      const mapped = NPM_FRAMEWORK_MAP[dep] ?? NPM_FRAMEWORK_MAP[base];
      if (mapped !== undefined) addTag(tags, mapped);
      if (dep === 'vue') {
        const version = versionOf(json, dep);
        if (version !== null && version.startsWith('3')) addTag(tags, 'Vue 3');
      }
    }
    return [...tags];
  }
  if (fileName === 'requirements.txt' || fileName === 'pyproject.toml') {
    const hay = text.toLowerCase();
    for (const [k, label] of Object.entries(PY_MAP)) {
      if (hay.includes(k)) addTag(tags, label);
    }
    return [...tags];
  }
  if (fileName === 'go.mod') {
    const hay = text.toLowerCase();
    for (const [k, label] of Object.entries(GO_MAP)) {
      if (hay.includes(k)) addTag(tags, label);
    }
    return [...tags];
  }
  if (fileName === 'cargo.toml') {
    const hay = text.toLowerCase();
    for (const [k, label] of Object.entries(RUST_MAP)) {
      if (hay.includes(k)) addTag(tags, label);
    }
    return [...tags];
  }
  if (fileName === 'pom.xml' || fileName.endsWith('.csproj')) {
    for (const [re, label] of JAVA_HINTS) {
      if (re.test(text)) addTag(tags, label);
    }
    if (fileName.endsWith('.csproj')) {
      if (/<TargetFramework/.test(text)) addTag(tags, '.NET');
    }
    return [...tags];
  }
  if (fileName === 'dockerfile' || fileName === 'docker-compose.yml' || fileName === 'docker-compose.yaml') {
    return ['Docker'];
  }
  if (fileName === 'tauri.conf.json') {
    return ['Tauri'];
  }
  return null;
}

function versionOf(json: Record<string, unknown>, dep: string): string | null {
  for (const key of ['dependencies', 'devDependencies']) {
    const deps = json[key];
    if (typeof deps === 'object' && deps !== null) {
      const v = (deps as Record<string, unknown>)[dep];
      if (typeof v === 'string') return v.replace(/[^0-9.]/g, '');
    }
  }
  return null;
}

export function mergeTechStack(existing: string[], add: string[]): string[] {
  const set = new Set([...existing, ...add]);
  return [...set].slice(0, MAX_TAGS);
}
