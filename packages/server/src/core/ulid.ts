import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID：时间有序 + 密码学随机，本地生成、离线唯一（NM-1）。 */
export function ulid(now: number = Date.now()): string {
  let time = now;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ENCODING[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const rnd = randomBytes(16);
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    const b = rnd[i];
    randPart += ENCODING[(b ?? 0) % 32];
  }
  return timePart + randPart;
}
