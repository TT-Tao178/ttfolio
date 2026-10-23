/** e2e 公共助手（第 65 轮解冻整备）。 */
import type { Page } from '@playwright/test';

/**
 * 跳过新手导览（T-120）：全新环境（0 项目 && 未看过）会在启动后自动弹 antd Tour，
 * 遮罩会挡住后续交互——出现即点右上角 × 关闭（localStorage 记忆随之写入）。
 */
export async function dismissTour(page: Page): Promise<void> {
  const close = page.locator('.ant-tour-close');
  await close.click({ timeout: 2500 }).catch(() => {
    /* 未弹出（已有项目或已看过）——正常路径 */
  });
}

/**
 * 回到工作台总览屏：服务端会话恢复可能把活动标签还原成项目/其他标签。
 * 注意（第 65 轮取证）：AddProjectModal 登记成功后有意的「切到卡片墙」行为
 * （Workbench onSuccess → subTab:'view:all'，0.3.5 的"添加了但没反应"修复）会让
 * 工作台标签显示卡片墙而非 Dashboard——两者都有添加项目入口与项目卡片，等任一出现。
 */
export async function gotoWorkbench(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-testid="tab-bar"]').waitFor({ state: 'visible', timeout: 20000 });
  const workbenchTab = page
    .locator('[data-testid="tab-bar"] [data-testid="tab-title"]')
    .filter({ hasText: '工作台' })
    .first();
  if ((await workbenchTab.count()) > 0) {
    await workbenchTab.click();
  }
  await page
    .locator('[data-testid="dashboard"], [data-testid="workbench"] [data-testid="add-project-btn"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(async () => {
      const titles = await page.locator('[data-testid="tab-bar"] [data-testid="tab-title"]').allInnerTexts();
      const active = await page
        .locator('[data-testid="tab-bar"] [data-active="1"] [data-testid="tab-title"]')
        .allInnerTexts();
      const dash = await page.locator('[data-testid="dashboard"]').count();
      const addBtn = await page.locator('[data-testid="add-project-btn"]').count();
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
      throw new Error(
        `gotoWorkbench 失败：tabs=${JSON.stringify(titles)} active=${JSON.stringify(active)} dashboard=${dash} addBtn=${addBtn} body=${JSON.stringify(bodyText)} url=${page.url()}`,
      );
    });
}
