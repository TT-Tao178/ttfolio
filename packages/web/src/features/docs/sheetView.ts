/**
 * 表格（xlsx）预览的数据模型（2026-11-15 体检 P1）。
 *
 * 为什么不再用 `XLSX.utils.sheet_to_html` + dangerouslySetInnerHTML：
 * 它只转义单元格**文本**，却原样输出超链接目标——一个把 `javascript:` 写进超链接的
 * xlsx，会在预览里生成可点击的 `<a href="javascript:...">`，点一下就在应用主源里执行
 * 脚本（主源的 window.__TTFOLIO_TOKEN__ 是明文，等于把全部接口交出去）。
 *
 * 这里改成"自己算格子、交给 React 渲染"：输出模型里只有纯文本与已校验过的 http(s)
 * 链接，DOM 由 React 生成，天然没有 HTML 注入面。
 */

export interface SheetCell {
  /** 显示文本（优先用 xlsx 的格式化值 w，其次原值） */
  text: string;
  colSpan: number;
  rowSpan: number;
  /** 仅 http/https 的链接目标；其余一律为 null（不渲染成 <a>） */
  href: string | null;
}

export interface SheetGrid {
  /** 每行若干格；null = 被左侧/上方的合并单元格覆盖，不渲染 */
  rows: Array<Array<SheetCell | null>>;
  /** 行/列被截断（超大表只画前 N 行 N 列） */
  truncated: boolean;
}

interface CellLike {
  v?: unknown;
  w?: string;
  l?: { Target?: unknown };
}
export interface WorksheetLike {
  '!ref'?: string;
  '!merges'?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  [addr: string]: unknown;
}

const MAX_ROWS = 2000;
const MAX_COLS = 200;
const MAX_CELL_CHARS = 4000;

/** 只放行 http/https 的绝对 URL；`javascript:` / `data:` / `vbscript:` / 相对路径全部拒绝。 */
export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (s === '' || s.length > 2048) return false;
  // 先挡掉控制字符与空白混淆（"java\nscript:" 这类）；URL 里本不该出现裸空白
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return false;
  }
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** "A1" → {r:0,c:0}；无法解析返回 null。 */
function decodeAddr(addr: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(addr);
  if (m === null) return null;
  let c = 0;
  for (const ch of m[1] as string) c = c * 26 + (ch.charCodeAt(0) - 64);
  const r = Number(m[2]);
  if (r < 1 || c < 1) return null;
  return { r: r - 1, c: c - 1 };
}

/** {r,c} → "A1" */
function encodeAddr(r: number, c: number): string {
  let n = c + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${r + 1}`;
}

/** 解析 "A1:C3" 形式的范围；解析失败返回 null。 */
function decodeRange(ref: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const [from, to] = ref.split(':');
  const a = from === undefined ? null : decodeAddr(from);
  const b = to === undefined ? a : decodeAddr(to);
  if (a === null || b === null) return null;
  return {
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

function cellText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'object') return String(raw);
  const cell = raw as CellLike;
  const text =
    typeof cell.w === 'string' ? cell.w : cell.v === undefined || cell.v === null ? '' : String(cell.v);
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

/**
 * 把工作表算成可渲染的网格。
 * 上限防护：超大表只画前 2000 行 / 200 列（`truncated` 置真），避免一次渲染几十万节点卡死。
 */
export function buildSheetGrid(ws: WorksheetLike): SheetGrid {
  const ref = typeof ws['!ref'] === 'string' ? ws['!ref'] : '';
  const range = ref === '' ? null : decodeRange(ref);
  if (range === null) return { rows: [], truncated: false };

  const rowCount = Math.min(range.r2 - range.r1 + 1, MAX_ROWS);
  const colCount = Math.min(range.c2 - range.c1 + 1, MAX_COLS);
  const truncated = range.r2 - range.r1 + 1 > rowCount || range.c2 - range.c1 + 1 > colCount;

  // 合并单元格：锚点记 span，覆盖区记 null
  const anchors = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();
  for (const m of Array.isArray(ws['!merges']) ? ws['!merges'] : []) {
    const r1 = m.s.r - range.r1;
    const c1 = m.s.c - range.c1;
    const r2 = m.e.r - range.r1;
    const c2 = m.e.c - range.c1;
    if (r2 < 0 || c2 < 0 || r1 >= rowCount || c1 >= colCount) continue;
    const rowSpan = Math.max(1, Math.min(r2, rowCount - 1) - Math.max(r1, 0) + 1);
    const colSpan = Math.max(1, Math.min(c2, colCount - 1) - Math.max(c1, 0) + 1);
    if (rowSpan > 1 || colSpan > 1) anchors.set(`${r1},${c1}`, { rowSpan, colSpan });
    for (let r = r1; r <= Math.min(r2, rowCount - 1); r++) {
      for (let c = c1; c <= Math.min(c2, colCount - 1); c++) {
        if (r === r1 && c === c1) continue;
        covered.add(`${r},${c}`);
      }
    }
  }

  const rows: Array<Array<SheetCell | null>> = [];
  for (let r = 0; r < rowCount; r++) {
    const row: Array<SheetCell | null> = [];
    for (let c = 0; c < colCount; c++) {
      const key = `${r},${c}`;
      if (covered.has(key)) {
        row.push(null);
        continue;
      }
      const raw = ws[encodeAddr(r + range.r1, c + range.c1)];
      const span = anchors.get(key);
      const link = raw !== null && typeof raw === 'object' ? (raw as CellLike).l?.Target : undefined;
      row.push({
        text: cellText(raw),
        colSpan: span?.colSpan ?? 1,
        rowSpan: span?.rowSpan ?? 1,
        href: isSafeExternalUrl(link) ? link.trim() : null,
      });
    }
    rows.push(row);
  }
  return { rows, truncated };
}
