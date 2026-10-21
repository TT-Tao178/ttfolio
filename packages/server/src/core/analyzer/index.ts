/**
 * 分析器（FR-3.x / 8.1）：单次遍历、只读 dirent/stat、可取消、幂等、EACCES 跳过记 partial。
 * 一个事务写库（projects + language_stats + analysis_runs），发 SSE。
 */
import path from 'node:path';
import type Database from 'better-sqlite3';
import * as fsx from '../fsx.js';
import { languageForFile, topLanguages, type LangAccum } from './languages.js';
import { extractFromManifest, mergeTechStack } from './techStack.js';
import {
  detectProjectType,
  isFrontendDirName,
  isBackendDirName,
  type TypeDetectInput,
} from './typeDetect.js';
import { summaryForAnalyze } from '../git.js';
import type { TaskContext } from '../tasks.js';
import { buildMatcher } from '../search.js';
import type { SseHub } from '../sse.js';
import { patchProject } from '../../db/repo/projectsRepo.js';
import { upsertArchive } from '../../db/repo/docsRepo.js';
import { mediaKindOf } from '../media.js';
import { ulid } from '../ulid.js';

const SCRIPT_EXTS = new Set(['ps1', 'sh', 'bat', 'cmd', 'py']);
const ASSET_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'mp4',
  'mov',
  'mp3',
  'wav',
  'psd',
  'ai',
  'fig',
  'sketch',
  'blend',
  'avi',
  'mkv',
  'flac',
  'tif',
  'bmp',
]);

export interface AnalyzeRunResult {
  projectId: string;
  ok: boolean;
  partial: boolean;
  error: string | null;
  durationMs: number;
  scannedFiles: number;
  scannedBytes: number;
}

interface ManifestHit {
  rel: string;
  name: string;
  size: number;
}

/** 对单项目执行分析（同步遍历，异步包装以支持取消让步）。 */
export async function analyzeProject(
  db: Database.Database,
  project: { id: string; dirPath: string; typeSource: string; defaultArchDir: string },
  sse: SseHub,
  ctx: TaskContext,
): Promise<AnalyzeRunResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let partial = false;
  let partialReason = '';

  const matcher = buildMatcher(db, project.id);
  const acc: LangAccum = {};
  const manifests: ManifestHit[] = [];
  const manifestSubDirs = new Set<string>();
  let scriptBytes = 0;
  let assetBytes = 0;
  let fileCount = 0;
  let totalBytes = 0;
  let hasDocs = false;
  let hasArch = false;
  let composeServices = 0;
  let hasGatewayDir = false;
  let hasServerTemplates = false;
  let frontendDepDirs: string[] = [];
  let backendDepDirs: string[] = [];
  let frontendFramework = false;
  let rootPackageJson: string | null = null;
  let hasIndexHtml = false;
  let backendFramework = false;
  let composeContent: string | null = null;
  const mediaFiles: Array<{
    rel: string;
    kind: 'image' | 'video' | 'audio';
    bytes: number;
    mtime: string | null;
  }> = [];

  // ---- 单次遍历 ----
  const root = project.dirPath;
  const stack: Array<{ abs: string; rel: string; depth: number }> = [{ abs: root, rel: '', depth: 0 }];
  while (stack.length > 0) {
    ctx.checkCancelled();
    const cur = stack.pop();
    if (cur === undefined) break;
    let entries: fsx.FsEntry[] = [];
    try {
      entries = fsx.listEntries(cur.abs);
    } catch {
      partial = true;
      partialReason = `目录不可读：${cur.rel || '.'}`;
      continue;
    }
    for (const e of entries) {
      const rel = cur.rel === '' ? e.name : `${cur.rel}/${e.name}`;
      const abs = path.join(cur.abs, e.name);
      if (matcher.isHidden(rel)) continue;
      if (e.isDir) {
        const lower = e.name.toLowerCase();
        if (lower === 'gateway' || lower === 'api-gateway') hasGatewayDir = true;
        if (lower === 'templates' || lower === 'static') hasServerTemplates = true;
        if (lower === 'docs' || e.name === '设计文档' || lower === 'doc') hasDocs = true;
        if (e.name === project.defaultArchDir) hasArch = true;
        stack[stack.length] = { abs, rel, depth: cur.depth + 1 };
        continue;
      }
      if (!e.isFile) continue;
      let size = 0;
      let mtimeIso: string | null = null;
      try {
        const st = fsx.statSync(abs);
        size = st.size;
        const mt = st.mtime instanceof Date ? st.mtime : new Date(st.mtime);
        mtimeIso = Number.isNaN(mt.getTime()) ? null : mt.toISOString();
      } catch {
        partial = true;
        continue;
      }
      fileCount++;
      totalBytes += size;

      const lang = languageForFile(e.name);
      const ext = (e.name.split('.').pop() ?? '').toLowerCase();
      const analyzeOnly = matcher.isAnalyzeOnly(rel);
      if (lang !== null && !analyzeOnly) {
        const slot = acc[lang] ?? { bytes: 0, files: 0 };
        slot.bytes += size;
        slot.files += 1;
        acc[lang] = slot;
      }
      if (SCRIPT_EXTS.has(ext)) scriptBytes += size;
      if (ASSET_EXTS.has(ext)) assetBytes += size;
      const mediaKind = mediaKindOf(e.name);
      if (mediaKind !== null) {
        mediaFiles[mediaFiles.length] = { rel, kind: mediaKind, bytes: size, mtime: mtimeIso };
      }

      const lower = e.name.toLowerCase();
      if (lower === 'readme.md' || lower === 'readme.txt' || lower === 'readme') hasDocs = true;
      if (ext === 'md' && !rel.includes('/')) hasDocs = true;
      if (lower === 'index.html' && cur.depth <= 1) hasIndexHtml = true;
      if (MANIFEST_FILES.has(lower)) {
        manifests[manifests.length] = { rel, name: lower, size };
        if (cur.depth === 1) manifestSubDirs.add(cur.rel);
        if (cur.depth === 0) {
          if (lower === 'package.json') rootPackageJson = rel;
          if (lower === 'pom.xml' || lower === 'build.gradle' || lower === 'go.mod' || lower === 'cargo.toml')
            backendFramework = true;
        }
        if (cur.depth === 1 && cur.rel !== '') {
          const parentName = cur.rel.split('/').pop() ?? '';
          if (lower === 'package.json') {
            frontendDepDirs[frontendDepDirs.length] = parentName;
          } else {
            backendDepDirs[backendDepDirs.length] = parentName;
          }
        }
      }
      if (lower === 'docker-compose.yml' || lower === 'docker-compose.yaml') {
        try {
          composeContent = fsx.readFileSync(abs, 'utf8');
        } catch {
          composeContent = null;
        }
      }
      if (e.name === project.defaultArchDir || lower.endsWith('.html')) {
        // 架构图目录探测在遍历后统一处理
      }
    }
    if ((fileCount & 1023) === 0) {
      ctx.progress(fileCount, 0);
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  if (composeContent !== null) {
    composeServices = countComposeServices(composeContent);
  }

  // ---- 清单解析 → 技术栈 ----
  let techStack: string[] = [];
  for (const m of manifests.slice(0, 40)) {
    ctx.checkCancelled();
    try {
      const text = fsx.readFileSync(path.join(root, m.rel), 'utf8');
      const tags = extractFromManifest(m.rel, text, m.size);
      if (tags !== null) techStack = mergeTechStack(techStack, tags);
    } catch {
      partial = true;
      partialReason = partialReason === '' ? `清单读取失败：${m.rel}` : partialReason;
    }
  }
  if (rootPackageJson !== null && techStack.length === 0) {
    // 根 package.json 存在但没提取到框架 —— 静态站判断在类型识别里做
  }
  frontendFramework = techStack.some((t) =>
    ['React', 'Vue', 'Vue 3', 'Nuxt', 'Next.js', 'Angular', 'Svelte', 'SvelteKit', 'Vite', 'Tauri'].includes(
      t,
    ),
  );
  if (rootPackageJson !== null) {
    try {
      const pkg = fsx.readFileSync(path.join(root, rootPackageJson), 'utf8');
      frontendFramework = frontendFramework || /"react"|"vue"|@angular\/core|"svelte"|"vite"/.test(pkg);
    } catch {
      /* 已在上面判定过 */
    }
  }
  // 前端/后端子目录带清单的精细判断
  frontendDepDirs = frontendDepDirs.filter((d) => isFrontendDirName(d));
  backendDepDirs = backendDepDirs.filter((d) => isBackendDirName(d));

  // ---- 类型 ----
  let type: string;
  if (project.typeSource === 'manual') {
    const row = db
      .prepare<[string], { type: string }>('SELECT type FROM projects WHERE id = ?')
      .get(project.id);
    type = row?.type ?? 'unknown';
  } else {
    const input: TypeDetectInput = {
      manifestSubDirs: [...manifestSubDirs],
      composeServices,
      hasGatewayDir,
      frontendDepDirs,
      backendDepDirs,
      hasBackendFramework: backendFramework,
      hasServerTemplates,
      frontendFramework,
      hasIndexHtmlWithPackageJson: hasIndexHtml && rootPackageJson !== null,
      scriptBytes,
      totalBytes,
      assetBytes,
    };
    type = detectProjectType(input);
  }

  // ---- Git 摘要（只读） ----
  const gitInfo = await summaryForAnalyze(root);
  if (gitInfo.partial) partial = true;
  if (!gitInfo.isRepo) {
    // 非 repo 不算 partial（很常见）
  }

  // ---- 语言占比 ----
  const langs = topLanguages(acc);
  const primary = langs[0]?.language ?? null;

  // ---- 架构图目录登记（默认 项目内 defaultArchDir/） ----
  const archDirAbs = path.join(root, project.defaultArchDir);
  if (fsx.exists(archDirAbs) && fsx.statSafe(archDirAbs)?.isDir) {
    hasArch = true;
    const info = computeArchiveMeta(archDirAbs);
    upsertArchive(db, {
      projectId: project.id,
      dirPath: archDirAbs,
      label: project.defaultArchDir,
      isDefault: true,
      htmlCount: info.htmlFiles.length,
      totalBytes: info.totalBytes,
      entryRel: info.entryRel,
      entrySource: info.entrySource,
    });
  }

  const durationMs = Date.now() - t0;
  const finishedAt = new Date().toISOString();

  // ---- 一个事务写库 ----
  const tx = db.transaction(() => {
    db.prepare('UPDATE projects SET has_docs = ?, has_arch = ? WHERE id = ?').run(
      hasDocs ? 1 : 0,
      hasArch ? 1 : 0,
      project.id,
    );
    patchProject(db, project.id, {
      type,
      primary_language: primary,
      file_count: fileCount,
      size_bytes: totalBytes,
      tech_stack: JSON.stringify(techStack),
      git_is_repo: gitInfo.isRepo ? 1 : 0,
      git_branch: gitInfo.branch,
      git_dirty: gitInfo.dirty ? 1 : 0,
      git_untracked: gitInfo.untracked,
      git_last_commit_at: gitInfo.lastCommitAt,
      git_last_commit_author: gitInfo.lastCommitAuthor,
      git_last_commit_subject: gitInfo.lastCommitSubject,
      git_head_short: gitInfo.headShort,
      analyzed_at: finishedAt,
      analyze_ms: durationMs,
      analyze_partial: partial ? 1 : 0,
      analyze_error: partial ? partialReason : null,
      path_ok: 1,
      path_checked_at: finishedAt,
    });
    db.prepare('DELETE FROM media_files WHERE project_id = ?').run(project.id);
    const insMedia = db.prepare(
      'INSERT INTO media_files (id, project_id, path, kind, bytes, mtime) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const m of mediaFiles) insMedia.run(ulid(), project.id, m.rel, m.kind, m.bytes, m.mtime);
    db.prepare('DELETE FROM language_stats WHERE project_id = ?').run(project.id);
    const insLang = db.prepare(
      'INSERT INTO language_stats (project_id, language, bytes, file_count) VALUES (?, ?, ?, ?)',
    );
    for (const l of langs) insLang.run(project.id, l.language, l.bytes, l.files);
    db.prepare(
      `INSERT INTO analysis_runs (project_id, started_at, finished_at, ok, scanned_files, scanned_bytes, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      project.id,
      startedAt,
      finishedAt,
      partial ? 1 : 0,
      fileCount,
      totalBytes,
      durationMs,
      partial ? partialReason : null,
    );
  });
  tx();

  sse.publish('project.analyzed', { projectId: project.id });
  return {
    projectId: project.id,
    ok: true,
    partial,
    error: partial ? partialReason : null,
    durationMs,
    scannedFiles: fileCount,
    scannedBytes: totalBytes,
  };
}

const MANIFEST_FILES = new Set([
  'package.json',
  'pom.xml',
  'build.gradle',
  'go.mod',
  'cargo.toml',
  'requirements.txt',
  'pyproject.toml',
  'composer.json',
  'gemfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'dockerfile',
  'tauri.conf.json',
]);

function countComposeServices(text: string): number {
  let count = 0;
  let inServices = false;
  for (const line of text.split(/\r?\n/)) {
    const indent = line.search(/\S/);
    if (indent === 0) {
      inServices = /^services\s*:/.test(line.trim());
      continue;
    }
    if (inServices && indent === 2 && /:\s*$/.test(line.trim())) count++;
  }
  return count;
}

export interface ArchiveMeta {
  htmlFiles: Array<{ rel: string; mtime: string; size: number; hasSourceJson: boolean }>;
  /** 图片文件（第 26 轮）：png/jpg/jpeg/gif/webp/svg/bmp——架构图目录常见产物，供页签内直接预览 */
  imageFiles: Array<{ rel: string; mtime: string; size: number; hasSourceJson: boolean }>;
  /** 文本类文件（第 26 轮）：md/markdown/txt/json——archify 产物的说明与源文件，只读取文本预览 */
  textFiles: Array<{ rel: string; mtime: string; size: number; hasSourceJson: boolean }>;
  totalBytes: number;
  entryRel: string | null;
  entrySource: 'index_html' | 'manual' | 'list';
}

/** 架构图目录元数据（入口识别：manual → index.html → list）。 */
export function computeArchiveMeta(dirAbs: string, manualEntry?: string | null): ArchiveMeta {
  const htmlFiles: ArchiveMeta['htmlFiles'] = [];
  const imageFiles: ArchiveMeta['imageFiles'] = [];
  const textFiles: ArchiveMeta['textFiles'] = [];
  let totalBytes = 0;
  const stack: string[] = [dirAbs];
  let indexRel: string | null = null;
  const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  const TEXT_RE = /\.(md|markdown|txt|json)$/i;
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: fsx.FsEntry[] = [];
    try {
      entries = fsx.listEntries(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(dirAbs, abs).split(path.sep).join('/');
      if (e.isDir) {
        stack[stack.length] = abs;
        continue;
      }
      const lower = e.name.toLowerCase();
      const st = fsx.statSafe(abs);
      if (st === null) continue;
      totalBytes += st.size;
      if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        if (lower === 'index.html' && indexRel === null) indexRel = rel;
        htmlFiles[htmlFiles.length] = {
          rel,
          mtime: st.mtimeIso,
          size: st.size,
          hasSourceJson: fsx.exists(abs.replace(/\.html?$/i, '.architecture.json')),
        };
      } else if (IMAGE_RE.test(lower)) {
        imageFiles[imageFiles.length] = { rel, mtime: st.mtimeIso, size: st.size, hasSourceJson: false };
      } else if (TEXT_RE.test(lower)) {
        textFiles[textFiles.length] = { rel, mtime: st.mtimeIso, size: st.size, hasSourceJson: false };
      }
    }
  }
  htmlFiles.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  imageFiles.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  textFiles.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  let entryRel: string | null = null;
  let entrySource: ArchiveMeta['entrySource'] = 'list';
  if (manualEntry !== undefined && manualEntry !== null && manualEntry !== '') {
    entryRel = manualEntry;
    entrySource = 'manual';
  } else if (indexRel !== null) {
    entryRel = indexRel;
    entrySource = 'index_html';
  }
  return { htmlFiles, imageFiles, textFiles, totalBytes, entryRel, entrySource };
}
