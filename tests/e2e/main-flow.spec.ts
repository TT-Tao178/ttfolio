/**
 * e2e 主流程 1（FR-2.1 → FR-4.3 → FR-5.3/5.4）：
 * 添加项目（粘贴路径）→ 卡片分析结果 → 打开文件 → 编辑保存 → Git 暂存提交（一次提交只含暂存文件）。
 */
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gotoWorkbench } from './helpers';

const FIXTURE = path.resolve(process.cwd(), '.tmp-test', 'e2e-fixture-a');

test.beforeAll(() => {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'README.md'), '# e2e 项目 A\n\n初始内容\n');
  fs.writeFileSync(path.join(FIXTURE, 'notes.md'), '# 笔记\n第一版\n');
  fs.writeFileSync(path.join(FIXTURE, 'package.json'), JSON.stringify({ name: 'e2e-a', dependencies: { vue: '^3.4.0', vite: '^5.0.0' } }));
  fs.writeFileSync(path.join(FIXTURE, 'main.ts'), 'export const n = 1;\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: FIXTURE });
  execFileSync('git', ['config', 'user.email', 'e2e@local'], { cwd: FIXTURE });
  execFileSync('git', ['config', 'user.name', 'e2e'], { cwd: FIXTURE });
  execFileSync('git', ['add', '.'], { cwd: FIXTURE });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: FIXTURE });
});

test.afterAll(() => {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
});

test('添加项目 → 打开文件 → 编辑保存 → Git 暂存提交', async ({ page }) => {
  // 1) 粘贴路径登记
  await gotoWorkbench(page);
  await page.locator('[data-testid="add-project-btn"]').click();
  await expect(page.locator('[data-testid="paste-paths"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-testid="paste-paths"]').fill(FIXTURE);
  await page.locator('[data-testid="paste-add-btn"]').click();
  await page.waitForTimeout(2500);

  // 2) 卡片出现且带分析结果（Vue → 前端）
  const card = page.locator('[data-testid="project-card"]', { hasText: 'e2e-fixture-a' }).first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.locator('text=Vue').first()).toBeVisible({ timeout: 15000 });

  // 3) 点卡片 → 项目页默认落「文件」
  await card.click();
  await expect(page.locator('[data-testid="project-subtab"]')).toHaveAttribute('data-active', 'files');

  // 4) 打开 notes.md → 编辑器出现
  await page.locator('[data-testid="file-tree"] .ant-tree-title', { hasText: 'notes.md' }).first().click();
  await expect(page.locator('[data-testid="editor-pane"]')).toBeVisible({ timeout: 10000 });
  // 编辑器默认只读（FR-4.3，T-028）：先进编辑态
  await page.locator('[data-testid="edit-btn"]').click();

  // 5) 编辑 + Ctrl+S 保存（未保存圆点出现再消失）
  await page.locator('[data-testid="editor-pane"] .cm-content').click();
  await page.keyboard.type('\n新增行 by e2e');
  await expect(page.locator('[data-testid="dirty-dot"]')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.locator('[data-testid="dirty-dot"]')).toBeHidden({ timeout: 10000 });
  expect(fs.readFileSync(path.join(FIXTURE, 'notes.md'), 'utf8')).toContain('新增行 by e2e');

  // 6) Git 页签：只有 notes.md 未暂存 → 暂存 → 提交
  // 页签改点选：编辑器聚焦时数字快捷键会被全局键处理器跳过
  await page.locator('[data-testid="project-tabs"] .ant-tabs-tab', { hasText: 'Git' }).click();
  await page.waitForTimeout(800);
  await page.locator('[data-testid="commit-message"]').fill('feat: e2e 提交（只包含暂存文件）');
  // 暂存 notes.md
  const unstagedNode = page.locator('.ant-tree-title', { hasText: 'notes.md' }).first();
  await unstagedNode.click();
  await page.locator('button', { hasText: '暂存' }).first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-testid="commit-btn"]').click();
  await page.waitForTimeout(1500);

  // 7) 仓库验证：提交存在，且一次提交只包含暂存文件
  const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: FIXTURE, encoding: 'utf8' });
  expect(log).toContain('只包含暂存文件');
  const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: FIXTURE, encoding: 'utf8' });
  expect(files.trim().split('\n')).toEqual(['notes.md']);
});
