/** Agent 交接（FR-12.1）：上下文契约导出 + 上下文包。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { getProjectSummary } from '../db/repo/projectsRepo.js';
import { listMounts, listArchives, toArchiveInfo } from '../db/repo/docsRepo.js';
import { listTodos } from '../db/repo/sessionRepo.js';
import { contextContractSchema } from '@ttfolio/shared';
import * as fsx from '../core/fsx.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { currentActor } from '../core/actor.js';

/** 构建上下文包纯文本（FR-12.1 / FR-13.1 共用）；项目不存在返回 null。 */
export function buildContextPacket(db: Database.Database, id: string): string | null {
  const p = getProjectSummary(db, id);
  if (p === null) return null;
  const mounts = listMounts(db, id);
  const archives = listArchives(db, id).map((a) => toArchiveInfo(a, [], [], false));
  const todos = listTodos(db, { projectId: id, includeDone: false });
  const lines = [
    `# 项目上下文包`,
    ``,
    `- 项目名：${p.alias ?? p.diskName}${p.alias !== null ? `（磁盘目录：${p.diskName}）` : ''}`,
    `- 路径：${p.dirPath}`,
    `- 类型：${p.type}`,
    `- 主语言：${p.primaryLanguage ?? '未分析'}`,
    `- 语言占比：${
      p.languages
        .slice(0, 5)
        .map((l) => `${l.language} ${l.percent}%`)
        .join(' / ') || '未分析'
    }`,
    `- 技术栈：${p.techStack.join('、') || '—'}`,
    `- Git：${p.gitIsRepo ? `分支 ${p.gitBranch ?? '?'}${p.gitDirty ? '（有未提交改动）' : '（干净）'}` : '非 git 仓库'}`,
    `- 文档挂载：${mounts.length === 0 ? '无' : ''}`,
    ...mounts.map(
      (m) => `  - [${m.source === 'manual' ? '手动' : '自动'}] ${m.path}${m.existsOk ? '' : '（路径失效）'}`,
    ),
    `- 架构图：${archives.length === 0 ? '未登记' : archives.map((a) => a.dirPath).join('、')}`,
    `- 未完成清单：${todos.length === 0 ? '无' : ''}`,
    ...todos
      .slice(0, 20)
      .map((t) => `  - [${t.done ? 'x' : ' '}] ${t.title}${t.dueOn !== null ? `（截止 ${t.dueOn}）` : ''}`),
  ];
  return lines.join('\n');
}

/**
 * 项目 Markdown 报告（FR-13.12 / T-110）：速览/语言占比/技术栈/Git 摘要/
 * 标签集合备注/外链 + 上下文包与清单，给协作者与 agent 的便携摘要。
 * 与 context-packet 同源数据，不同呈现；只读聚合，不写任何项目目录。
 */
export function buildProjectReport(db: Database.Database, id: string): string | null {
  const p = getProjectSummary(db, id);
  if (p === null) return null;
  const packet = buildContextPacket(db, id) ?? '';
  const todos = listTodos(db, { projectId: id, includeDone: false });
  const mounts = listMounts(db, id);
  const lines = [
    `# ${p.alias ?? p.diskName} 项目报告`,
    '',
    `> 由 ttFolio 生成于 ${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 速览',
    '',
    `- 路径：\`${p.dirPath}\``,
    `- 类型：${p.type}${p.typeSource === 'manual' ? '（手动指定）' : ''}`,
    `- 主语言：${p.primaryLanguage ?? '未分析'}`,
    `- 规模：${p.fileCount} 个文件 · ${p.sizeBytes} 字节`,
    `- 语言占比：${
      p.languages
        .slice(0, 8)
        .map((l) => `${l.language} ${l.percent}%`)
        .join(' / ') || '未分析'
    }`,
    `- 技术栈：${p.techStack.join('、') || '—'}`,
    `- 标签：${p.tags.join('、') || '—'}`,
    `- 集合：${p.collections.join('、') || '—'}`,
    `- Git：${
      p.gitIsRepo
        ? `分支 \`${p.gitBranch ?? '?'}\`${p.gitDirty ? '（有未提交改动）' : '（干净）'}，最近提交 ${
            p.gitLastCommitAt ?? '—'
          }（${p.gitLastCommitAuthor ?? '—'}）`
        : '非 git 仓库'
    }`,
    `- 分析：${p.analyzedAt ?? '未分析'}${p.analyzeMs !== null ? `（耗时 ${p.analyzeMs}ms）` : ''}${
      p.analyzePartial ? '（部分成功）' : ''
    }`,
    ...(p.notes !== null && p.notes !== '' ? [`- 备注：${p.notes}`] : []),
    ...(p.externalLinks.length > 0
      ? ['', '## 相关链接', '', ...p.externalLinks.map((l) => `- [${l.label}](${l.url})`)]
      : []),
    '',
    '## 未完成清单',
    '',
    ...(todos.length === 0
      ? ['（无）']
      : todos.map((t) => `- [ ] ${t.title}${t.dueOn !== null ? `（截止 ${t.dueOn}）` : ''}`)),
    '',
    '## 文档挂载',
    '',
    ...(mounts.length === 0
      ? ['（无）']
      : mounts.map((m) => `- ${m.path}${m.existsOk ? '' : '（路径失效）'}`)),
    '',
    '## 附：项目上下文包',
    '',
    '```text',
    packet,
    '```',
    '',
  ];
  return lines.join('\n');
}

export const contractRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/projects/:id/context-packet', async (req) => {
    const { id } = req.params as { id: string };
    const packet = buildContextPacket(ctx.db(), id);
    if (packet === null) return fail('NOT_FOUND', '项目不存在', 404);
    return ok(packet);
  });

  // 项目 Markdown 报告（FR-13.12 / T-110）：直接回 markdown 附件（前端 blob 下载）
  app.get('/api/projects/:id/report', async (req, reply) => {
    const { id } = req.params as { id: string };
    const md = buildProjectReport(ctx.db(), id);
    if (md === null) return fail('NOT_FOUND', '项目不存在', 404);
    logActivity(ctx.db(), {
      kind: 'project.report_export',
      level: 'L1',
      projectId: id,
      actor: currentActor().actor,
    });
    reply.header('content-type', 'text/markdown; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="ttfolio-report.md"');
    return reply.send(md);
  });

  app.post('/api/projects/:id/context-contract', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = contextContractSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const p = getProjectSummary(db, id);
    if (p === null) return fail('NOT_FOUND', '项目不存在', 404);
    const userFields = parsed.data.fields;
    const md = [
      `# PROJECT-CONTEXT（项目上下文契约）`,
      ``,
      `> 本文件由 ttFolio 自动预填「可自动化字段」，其余字段请项目维护者补充。`,
      `> 生成时间：${new Date().toISOString()}（ttFolio ${ctx.version}）`,
      ``,
      `## 一、基本盘（自动预填）`,
      ``,
      `- 项目名：${p.alias ?? p.diskName}`,
      `- 磁盘路径：${p.dirPath}`,
      `- 项目类型：${p.type}${p.typeSource === 'manual' ? '（人工指定）' : ''}`,
      `- 主语言：${p.primaryLanguage ?? '未分析'}`,
      `- 语言占比：${
        p.languages
          .slice(0, 8)
          .map((l) => `${l.language} ${l.percent}%`)
          .join(' / ') || '未分析'
      }`,
      `- 技术栈：${p.techStack.join('、') || '—'}`,
      `- Git：${p.gitIsRepo ? `分支 ${p.gitBranch ?? '?'}，HEAD ${p.gitHeadShort ?? '?'}` : '非 git 仓库'}`,
      ``,
      `## 二、用户填写字段`,
      ``,
      `- 项目目标：${userFields['goal'] ?? '（待补充：一句话说清这个项目做什么）'}`,
      `- 运行方式：${userFields['run'] ?? '（待补充：如何安装/启动/测试）'}`,
      `- 目录导览：${userFields['layout'] ?? '（待补充：关键目录与文件）'}`,
      `- 硬性约束：${userFields['constraints'] ?? '（待补充：不能破坏的东西）'}`,
      `- 当前状态：${userFields['status'] ?? '（待补充）'}`,
      ``,
      `## 三、关联档案（自动预填）`,
      ``,
      `- 文档挂载：${
        listMounts(db, id)
          .map((m) => m.path)
          .join('、') || '无'
      }`,
      `- 架构图：${
        listArchives(db, id)
          .map((a) => a.dir_path)
          .join('、') || '未登记（可由外部工具生成后登记）'
      }`,
      `- 未完成清单：${listTodos(db, { projectId: id, includeDone: false }).length} 条`,
      ``,
      `## 四、给 agent 的注意事项`,
      ``,
      `- 磁盘是真相：改动前后以文件系统为准，本契约只是索引快照。`,
      `- 不要执行 push/pull 等网络操作（本项目工作流不含远程协作）。`,
    ].join('\n');
    if (parsed.data.writeToProject) {
      const target = path.join(p.dirPath, 'PROJECT-CONTEXT.md');
      try {
        fsx.accessSyncForWrite(dirnameExists(target) ? target : target);
        fsx.atomicWriteText(target, md, 'utf8', detectEolSafe(target));
      } catch (err) {
        return fail(
          'PERMISSION_DENIED',
          `写入项目根失败：${err instanceof Error ? err.message : String(err)}`,
          403,
        );
      }
      logActivity(db, {
        kind: 'context.contract.write',
        level: 'L2',
        projectId: id,
        targetPath: target,
        actor: currentActor().actor,
      });
    }
    return ok({ markdown: md, writtenToProject: parsed.data.writeToProject });
  });
};

function dirnameExists(_p: string): boolean {
  return true;
}

function detectEolSafe(_p: string): 'CRLF' | 'LF' {
  return 'LF';
}
