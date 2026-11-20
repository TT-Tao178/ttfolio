/**
 * 把「自绘安装器宿主(exe) + payload.zip」打成一个单文件安装包（SFX）。
 *
 * 结构： [host.exe][payload.zip][trailer 32B]
 * trailer = magic 'TTFPAY01' + offset(u64) + size(u64) + rawSize(u64)
 *
 * 为什么这样做：Electron 宿主自身只有 90MB 左右，程序本体压在 payload 里；
 * 运行时从自己的尾巴上把 zip 抠出来解压，不需要额外的 .7z/.zip 文件或解压工具。
 *
 * 用法：
 *   node scripts/pack-custom-installer.mjs --version 0.7.0 \
 *     --host dist-installer/installer-host.exe \
 *     --payload .tmp/payload.zip --raw <解压后字节数> \
 *     --out dist-electron/ttFolio-Setup-0.7.0.exe
 */
import fs from 'node:fs';
import path from 'node:path';

const argOf = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};

const version = argOf('--version');
const hostPath = argOf('--host', 'dist-installer/installer-host.exe');
const payloadPath = argOf('--payload');
const outPath = argOf('--out', `dist-electron/ttFolio-Setup-${version}.exe`);
const rawArg = Number(argOf('--raw', '0'));

if (!version || !payloadPath) {
  console.error(
    '用法：node scripts/pack-custom-installer.mjs --version 0.7.0 --payload <zip> [--host ...] [--out ...] [--raw N]',
  );
  process.exit(1);
}
for (const p of [hostPath, payloadPath]) {
  if (!fs.existsSync(p)) {
    console.error(`缺少文件：${p}`);
    process.exit(1);
  }
}

// rawSize 优先用参数，其次读 payload.zip.meta.json
let rawSize = rawArg;
if (rawSize <= 0) {
  try {
    rawSize = JSON.parse(fs.readFileSync(`${payloadPath}.meta.json`, 'utf8')).rawSize ?? 0;
  } catch {
    rawSize = 0;
  }
}

const hostSize = fs.statSync(hostPath).size;
const payloadSize = fs.statSync(payloadPath).size;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.copyFileSync(hostPath, outPath);
fs.appendFileSync(outPath, fs.readFileSync(payloadPath));

const trailer = Buffer.alloc(32);
trailer.write('TTFPAY01', 0, 'latin1');
trailer.writeBigUInt64LE(BigInt(hostSize), 8);
trailer.writeBigUInt64LE(BigInt(payloadSize), 16);
trailer.writeBigUInt64LE(BigInt(rawSize), 24);
fs.appendFileSync(outPath, trailer);

const total = fs.statSync(outPath).size;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(`宿主 ${mb(hostSize)} + 载荷 ${mb(payloadSize)} + 尾标 32B = ${mb(total)}`);
console.log(`输出 ${outPath}`);
