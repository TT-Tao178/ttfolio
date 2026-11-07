/** Token DPAPI 密码器（FR-16.5 / T-136，2026-11-07 用户点名 A 组）。
 *  实现：PowerShell + .NET ProtectedData（DPAPI CurrentUser）——与设计蓝本的
 *  koffi advapi32 方案同为 DPAPI，此处经 PowerShell 调用以避免服务端 bundle
 *  引入原生依赖（设计偏离已记录）。秘密走 stdin（不出现在进程命令行/参数列表）。
 *  CurrentUser 作用域：同用户任意进程可解（服务端独立进程可用），跨用户不可解。 */
import { execFile } from 'node:child_process';

const PS = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

function runPs(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      PS,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => {
        if (err !== undefined && err !== null) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve(stdout.trim());
      },
    );
    child.stdin?.write(input);
    child.stdin?.end();
  });
}

const PROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$err = $null',
  '$line = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($line)',
  '$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($enc))',
].join('; ');

const UNPROTECT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$line = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($line)',
  '$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($dec))',
].join('; ');

/** 明文 → DPAPI 密文（base64）。 */
export async function protectSecret(plain: string): Promise<string> {
  const b64plain = Buffer.from(plain, 'utf8').toString('base64');
  const out = await runPs(PROTECT_SCRIPT, b64plain);
  if (out === '') throw new Error('DPAPI protect failed (empty output)');
  return out;
}

/** DPAPI 密文（base64）→ 明文。失败抛错（调用方如实提示，绝不静默降级）。 */
export async function unprotectSecret(cipherB64: string): Promise<string> {
  const out = await runPs(UNPROTECT_SCRIPT, cipherB64);
  if (out === '') throw new Error('DPAPI unprotect failed (empty output)');
  return Buffer.from(out, 'base64').toString('utf8');
}
