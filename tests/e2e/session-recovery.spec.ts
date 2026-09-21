/** e2e 主流程 3（FR-1.4/4.4 + 红线 4）：编辑产生草稿 → 重启服务 → 草稿恢复；标签会话恢复。 */
import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE = path.resolve(process.cwd(), '.tmp-test', 'e2e-fixture-c');
const FILE = 'draft.txt';

test.beforeAll(() => {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'README.md'), '# e2e 项目 C\n');
  fs.writeFileSync(path.join(FIXTURE, FILE), '磁盘原始内容\n');
});

test.afterAll(() => {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
});

test('编辑未保存 → 草稿落库 → 刷新页面后草稿仍在', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid="add-project-btn"]').click();
  await page.locator('[data-testid="paste-paths"]').fill(FIXTURE);
  await page.locator('[data-testid="paste-add-btn"]').click();
  const card = page.locator('[data-testid="project-card"]', { hasText: 'e2e-fixture-c' }).first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page.locator('[data-testid="project-subtab"]')).toHaveAttribute('data-active', 'files');

  // 打开文件，编辑（不保存）→ 草稿 1s 防抖落库
  await page.locator('[data-testid="file-tree"] .ant-tree-title', { hasText: FILE }).first().click();
  await expect(page.locator('[data-testid="editor-pane"]')).toBeVisible();
  await page.locator('[data-testid="editor-pane"] .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('这是未保存的草稿内容 DRAFT-99');
  await expect(page.locator('[data-testid="dirty-dot"]')).toBeVisible();
  await page.waitForTimeout(2000); // 等草稿防抖写入

  // 刷新页面（模拟崩溃/重启后回到页面）
  await page.reload();
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="project-card"]', { hasText: 'e2e-fixture-c' }).first().click();
  await page.locator('[data-testid="file-tree"] .ant-tree-title', { hasText: FILE }).first().click();
  await expect(page.locator('[data-testid="editor-pane"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="editor-pane"]')).toContainText('DRAFT-99', { timeout: 10000 });
});

test('会话恢复：标签集合在页面重载后还原', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1500);
  const card = page.locator('[data-testid="project-card"]', { hasText: 'e2e-fixture-c' }).first();
  await card.click();
  await page.waitForTimeout(1800); // 等会话防抖保存

  await page.reload();
  await page.waitForTimeout(2000);
  // 重载后仍有一个项目标签（会话恢复）
  await expect(page.locator('[data-testid="tab-bar"]')).toContainText('e2e-fixture-c', { timeout: 10000 });
});
