/** e2e 主流程 2（FR-4.6/4.9 + 红线 3）：删除 → 回收站 → 恢复 → 内容一致。 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE = path.resolve(process.cwd(), '.tmp-test', 'e2e-fixture-b');
const TARGET = 'doomed.txt';
const CONTENT = '将被删除又恢复的内容';

test.beforeAll(() => {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'README.md'), '# e2e 项目 B\n');
  fs.writeFileSync(path.join(FIXTURE, TARGET), CONTENT);
});

test.afterAll(() => {
  fs.rmSync(FIXTURE, { recursive: true, force: true });
});

test('删除进回收站 → 恢复到原路径 → 内容一致', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-testid="add-project-btn"]').click();
  await page.locator('[data-testid="paste-paths"]').fill(FIXTURE);
  await page.locator('[data-testid="paste-add-btn"]').click();
  const card = page.locator('[data-testid="project-card"]', { hasText: 'e2e-fixture-b' }).first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await card.click();
  await expect(page.locator('[data-testid="project-subtab"]')).toHaveAttribute('data-active', 'files');

  // 选中文件 → 删除（弹出确认）
  await page.locator('[data-testid="file-tree"] .ant-tree-title', { hasText: TARGET }).first().click();
  await page.locator('button', { hasText: '删除' }).first().click();
  await page.locator('.ant-modal-confirm').waitFor();
  await page.locator('.ant-modal-confirm .ant-btn-dangerous').click();
  await page.waitForTimeout(800);
  expect(fs.existsSync(path.join(FIXTURE, TARGET))).toBe(false);

  // 回收站页可见并预览
  await page.locator('button:has(.anticon-delete)').first().click(); // 侧栏? 直接开回收站标签
  await page.waitForTimeout(500);
  await page.getByRole('button').filter({ has: page.locator('.anticon-restore') }).first();
  // 通过命令面板打开回收站
  await page.keyboard.press('Control+k');
  await page.locator('[data-testid="palette-input"]').fill('回收站');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="trash-page"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="trash-page"]', { hasText: TARGET })).toBeVisible();

  // 预览内容可见
  await page.locator('button', { hasText: '预览' }).first().click();
  await expect(page.locator('.ant-modal', { hasText: TARGET })).toBeVisible();
  await page.locator('.ant-modal .ant-btn', { hasText: '关闭' }).click();

  // 恢复
  await page.locator('button', { hasText: '恢复' }).first().click();
  await page.waitForTimeout(1000);

  // 文件回到原路径且内容一致（红线 3）
  expect(fs.readFileSync(path.join(FIXTURE, TARGET), 'utf8')).toBe(CONTENT);
});
