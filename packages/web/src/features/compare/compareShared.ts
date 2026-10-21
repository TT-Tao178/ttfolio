/** 文件对比（FR-13.9 / T-106b）的纯函数：对比规格编解码 + 行级对齐。 */

export interface CompareFileRef {
  projectId: string;
  path: string;
}

export interface CompareTrashRef {
  trashId: string;
  name: string;
}

export type CompareSide = CompareFileRef | CompareTrashRef;

export interface CompareSpec {
  left: CompareSide;
  right: CompareSide;
}

export function isTrashSide(s: CompareSide): s is CompareTrashRef {
  return 'trashId' in s;
}

export function encodeCompareSpec(s: CompareSpec): string {
  return JSON.stringify(s);
}

/** 反序列化 + 结构校验；坏值一律 null（会话里残留旧/坏数据时诚实降级为无效标签）。 */
export function decodeCompareSpec(v: string | null): CompareSpec | null {
  if (v === null || v === '') return null;
  try {
    const o: unknown = JSON.parse(v);
    if (typeof o !== 'object' || o === null) return null;
    const s = o as Partial<CompareSpec>;
    const isFileRef = (x: unknown): boolean =>
      typeof x === 'object' &&
      x !== null &&
      typeof (x as CompareFileRef).projectId === 'string' &&
      typeof (x as CompareFileRef).path === 'string';
    const isTrashRef = (x: unknown): boolean =>
      typeof x === 'object' &&
      x !== null &&
      typeof (x as CompareTrashRef).trashId === 'string' &&
      typeof (x as CompareTrashRef).name === 'string';
    if (s.left === undefined || s.right === undefined) return null;
    if (!(isFileRef(s.left) || isTrashRef(s.left))) return null;
    if (!(isFileRef(s.right) || isTrashRef(s.right))) return null;
    return { left: s.left, right: s.right };
  } catch {
    return null;
  }
}

export interface AlignedRow {
  left: string | null;
  right: string | null;
  same: boolean;
}

export interface AlignResult {
  rows: AlignedRow[];
  /** false = 中段超出 LCS 规模上限，已降级为按行数平行排列（不保证语义对应） */
  aligned: boolean;
}

/** LCS 动态规划的中段规模上限：1500×1500 ≈ 2.25M 格（Uint32Array 瞬态约 9MB）。 */
export const ALIGN_MIDDLE_CAP = 1500;

/**
 * 行级对齐：公共前后缀裁剪后对中段做 LCS，再把相邻删/插段配对成修改行；
 * 任一侧中段超限则降级为按行数平行排列。输入按 \n 切分（调用方负责）。
 */
export function alignLines(a: string[], b: string[]): AlignResult {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const rows: AlignedRow[] = [];
  for (let i = 0; i < start; i++) rows.push({ left: a[i] ?? null, right: a[i] ?? null, same: true });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  let mid: AlignedRow[];
  let aligned = true;
  if (midA.length === 0) {
    mid = midB.map((x) => ({ left: null, right: x, same: false }));
  } else if (midB.length === 0) {
    mid = midA.map((x) => ({ left: x, right: null, same: false }));
  } else if (midA.length <= ALIGN_MIDDLE_CAP && midB.length <= ALIGN_MIDDLE_CAP) {
    mid = pairRuns(lcsAlign(midA, midB));
  } else {
    aligned = false;
    const n = Math.max(midA.length, midB.length);
    mid = Array.from({ length: n }, (_, i) => ({
      left: midA[i] ?? null,
      right: midB[i] ?? null,
      same: midA[i] !== undefined && midB[i] !== undefined && midA[i] === midB[i],
    }));
  }
  rows.push(...mid);
  const tail = a.length - endA;
  for (let i = 0; i < tail; i++) {
    rows.push({ left: a[endA + i] ?? null, right: b[endB + i] ?? null, same: true });
  }
  return { rows, aligned };
}

/** 后缀式 LCS 长度表 + 贪心回溯（循环不变量保证索引在界内，?? 仅喂类型）。 */
function lcsAlign(A: string[], B: string[]): AlignedRow[] {
  const n = A.length;
  const m = B.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  // noUncheckedIndexedAccess 下 TypedArray 索引也带 undefined；界内恒有值，?? 0 仅喂类型
  const at = (k: number): number => dp[k] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    const ai = A[i] ?? '';
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        ai === (B[j] ?? '')
          ? at((i + 1) * w + (j + 1)) + 1
          : Math.max(at((i + 1) * w + j), at(i * w + (j + 1)));
    }
  }
  const out: AlignedRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const a = A[i] ?? '';
    const b = B[j] ?? '';
    if (a === b) {
      out.push({ left: a, right: b, same: true });
      i++;
      j++;
    } else if (at((i + 1) * w + j) >= at(i * w + (j + 1))) {
      out.push({ left: a, right: null, same: false });
      i++;
    } else {
      out.push({ left: null, right: b, same: false });
      j++;
    }
  }
  while (i < n) {
    out.push({ left: A[i] ?? null, right: null, same: false });
    i++;
  }
  while (j < m) {
    out.push({ left: null, right: B[j] ?? null, same: false });
    j++;
  }
  return out;
}

/**
 * 相邻的「纯删除段 + 纯插入段」两两配对成修改行（并排视图的预期语义：
 * 改动行左右对照，而不是先一列红再一列绿）。
 */
function pairRuns(rows: AlignedRow[]): AlignedRow[] {
  const out: AlignedRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const head = rows[i];
    if (head === undefined || head.left === null || head.right !== null) {
      if (head !== undefined) out.push(head);
      i++;
      continue;
    }
    let dels = 0;
    while (i + dels < rows.length) {
      const x = rows[i + dels];
      if (x === undefined || x.left === null || x.right !== null) break;
      dels++;
    }
    let adds = 0;
    while (i + dels + adds < rows.length) {
      const x = rows[i + dels + adds];
      if (x === undefined || x.left !== null || x.right === null) break;
      adds++;
    }
    const pairs = Math.min(dels, adds);
    for (let k = 0; k < pairs; k++) {
      out.push({
        left: rows[i + k]?.left ?? null,
        right: rows[i + dels + k]?.right ?? null,
        same: false,
      });
    }
    for (let k = i + pairs; k < i + dels; k++) {
      out.push({ left: rows[k]?.left ?? null, right: null, same: false });
    }
    for (let k = i + dels + pairs; k < i + dels + adds; k++) {
      out.push({ left: null, right: rows[k]?.right ?? null, same: false });
    }
    i = i + dels + adds;
  }
  return out;
}
