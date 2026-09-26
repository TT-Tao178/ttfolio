// 从 electron/build/icon.svg 生成多尺寸 Windows 图标 electron/build/icon.ico
// 用法：node scripts/make-icon.mjs
// 依赖：@playwright/test（无头 Chromium 矢量渲染）；ICO 容器按 PNG-in-ICO 规范手写，零额外依赖。
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sizes = [16, 24, 32, 48, 64, 128, 256];

const svg = readFileSync(join(root, 'electron/build/icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = [];
for (const size of sizes) {
  const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  // omitBackground 保留透明通道：圆角四角必须透明，否则桌面图标四周会露白底
  await page.setContent(`<style>*{margin:0;padding:0;background:transparent}</style>${sized}`);
  const buf = await page.locator('svg').screenshot({ type: 'png', omitBackground: true });
  pngs.push(buf);
  console.log(`渲染 ${size}x${size} -> ${buf.length} bytes`);
}
await browser.close();

// ICO：ICONDIR(6B) + ICONDIRENTRY×N(16B each) + PNG 数据
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const entries = [];
const datas = [];
let offset = 6 + 16 * sizes.length;
for (let i = 0; i < sizes.length; i++) {
  const e = Buffer.alloc(16);
  const s = sizes[i];
  e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  entries.push(e); datas.push(pngs[i]);
}
const ico = Buffer.concat([header, ...entries, ...datas]);
writeFileSync(join(root, 'electron/build/icon.ico'), ico);
console.log(`icon.ico 生成完毕：${ico.length} bytes，含 ${sizes.length} 个尺寸`);
