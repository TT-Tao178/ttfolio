/** Token DPAPI 密码器单测（FR-16.5 / T-136）：往返 + 坏密文拒绝。
 *  依赖 Windows DPAPI（PowerShell），非 Windows 跳过。 */
import { describe, expect, it } from 'vitest';
import { protectSecret, unprotectSecret } from './tokenCipher.js';

describe.skipIf(process.platform !== 'win32')('tokenCipher（DPAPI 往返）', () => {
  it('protect → unprotect 往返还原明文', async () => {
    const plain = 'ghp_testToken1234567890abcdefghij';
    const cipher = await protectSecret(plain);
    expect(cipher).not.toBe(plain);
    expect(cipher).not.toContain('ghp_');
    const back = await unprotectSecret(cipher);
    expect(back).toBe(plain);
  });

  it('坏密文解密抛错（不静默降级）', async () => {
    await expect(unprotectSecret('not-a-valid-cipher')).rejects.toThrow();
  });
});
