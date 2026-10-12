/** 格式化工具：相对时间、字节、相对日期。 */
export function relTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < 45 * 1000) return '刚刚';
  if (abs < hour) return `${Math.round(abs / min)} 分钟前`;
  if (abs < day) return `${Math.round(abs / hour)} 小时前`;
  if (abs < 30 * day) return `${Math.round(abs / day)} 天前`;
  return new Date(t).toLocaleDateString('zh-CN');
}

/**
 * 侧栏项目「最后打开」相对时间（第 34 轮用户定制分桶，刻意不同于 relTime 的
 * 「刚刚/N 分钟前」带空格口径）：<1分钟 → 1分钟内；<1小时 → N分钟前；
 * <24小时 → N小时前；<30天 → N天前；更久 → 日期；从未打开/无法解析 → 空串
 * （侧栏不占位，精确时刻放在悬浮 title 里）。now 仅供测试注入。
 */
export function openAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '1分钟内';
  if (diff < hour) return `${Math.floor(diff / min)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}天前`;
  return new Date(t).toLocaleDateString('zh-CN');
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function basename(p: string): string {
  const segs = p.split(/[\\/]/).filter((s) => s !== '');
  return segs[segs.length - 1] ?? p;
}
