/**
 * 终端输出路径识别（T-124 / FR-14.2 增强）纯函数：从一行终端文本抽出可点击的路径候选，
 * 并按「已登记项目 dirPath 前缀」配对到项目；配不上的绝对路径保留原文（点击降级复制）。
 * 保守原则：宁可少识别（漏了还能复制/手动导航），不误伤普通文本——
 * 相对路径必须「多段 + 末段带扩展名」；URL 紧邻的候选一律跳过（lookbehind + 前置字符检查）；
 * tsc 的 `path(12,5):` 与 node 栈的 `path:12:5` 两类高频行号后缀先剥再配对。
 * 识别与配对全部在纯函数里，供单测锁定；TerminalPanel 只负责 xterm range 换算与点击行为。
 */

export interface LinkProject {
  id: string;
  dirPath: string;
}

export interface ParsedPathLink {
  /** 行内起始下标（0 基，含） */
  start: number;
  /** 行内结束下标（不含） */
  end: number;
  /** 原样路径文本（已剥行号尾缀与尾部标点） */
  text: string;
  /** 命中的项目 id；null=未命中任何已登记项目（点击降级复制） */
  projectId: string | null;
  /** 相对项目根的路径（'/' 分隔，与服务端 rel 惯例一致；命中项目根本身为 ''） */
  relPath: string | null;
}

/** 每行最多产出多少个链接（防御病态输出，长输出 hover 不卡） */
export const MAX_LINKS_PER_LINE = 32;

/**
 * 绝对路径：盘符 + 分隔符；盘符前不能是词字符/':'/'.'（否则 https:// 的 `s://` 会被当成盘符）；
 * 字符集排除 Windows 非法字符、引号与括号（tsc 的 path(12,5) 括号计法由此天然截断）。
 */
const ABS_RE = /(?<![\w:.])[A-Za-z]:[\\/][^\s"'`<>|*?()[\]{}]+/g;
/** 相对路径：≥1 个「段 + 分隔符」且末段带扩展名点；不含空白与括号 */
const REL_RE = /(?:[\w@.-]+[\\/])+[\w@.-]*\.[A-Za-z0-9]+/g;
/** tsc / node 栈风格的行号列号尾缀（Windows 文件名不含 ':'，剥掉安全） */
const LINE_COL_SUFFIX = /:\d+(?::\d+)?$|[(:]\d+(?::\d+)?$/;

/** 尾部这些字符大概率是输出标点而非路径（Windows 文件名不允许以 . 和空格结尾，剥掉安全） */
const TRAILING_PUNCT = '.,;:!?)]}';

function trimTrailingPunct(s: string): string {
  let t = s;
  // 标点与行号尾缀交替剥到不动点：a.ts:12:5: → 剥尾':' → 剥 :12:5 → a.ts
  for (;;) {
    const before = t;
    let end = t.length;
    while (end > 0 && TRAILING_PUNCT.includes(t[end - 1] ?? '')) end -= 1;
    t = t.slice(0, end);
    t = t.replace(LINE_COL_SUFFIX, '');
    if (t === before) break;
  }
  return t;
}

/** 配对用归一：分隔符统一 '/'、去尾分隔符、小写（Windows 大小写不敏感） */
function normKey(p: string): string {
  return p
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** 绝对路径 → 命中的已登记项目（最长 dirPath 前缀胜出，支持项目嵌套登记）；未命中返回 null。 */
export function matchProjectPath(
  raw: string,
  projects: LinkProject[],
): { projectId: string; relPath: string } | null {
  const key = normKey(raw);
  let best: LinkProject | null = null;
  let bestKey = '';
  for (const p of projects) {
    const pk = normKey(p.dirPath);
    if (pk === '') continue;
    if (key === pk || key.startsWith(`${pk}/`)) {
      if (best === null || pk.length > bestKey.length) {
        best = p;
        bestKey = pk;
      }
    }
  }
  if (best === null) return null;
  return { projectId: best.id, relPath: bestKey === key ? '' : key.slice(bestKey.length + 1) };
}

export interface ExtractOptions {
  /** 已登记项目（active）；空列表时只可能产出「降级复制」的绝对路径链接 */
  projects: LinkProject[];
  /** 当前项目 id（终端 cwd 在项目内时才有）：相对路径按它解析 */
  cwdProjectId: string | null;
}

/**
 * 一行终端文本 → 可点击路径候选。
 * - 绝对路径：命中项目带 projectId/relPath；项目外 projectId=null（降级复制）。
 * - 相对路径：仅当 cwdProjectId 非空时识别，恒定归到当前项目；与绝对路径区间重叠、
 *   或紧邻 ':' '/' '\\'（URL 片段）的候选跳过。
 */
export function extractPathsFromLine(line: string, opts: ExtractOptions): ParsedPathLink[] {
  const out: ParsedPathLink[] = [];
  const push = (l: ParsedPathLink): void => {
    if (out.length >= MAX_LINKS_PER_LINE) return;
    if (out.some((x) => l.start < x.end && x.start < l.end)) return;
    out.push(l);
  };

  // 绝对路径优先（占住区间，相对路径的区间重叠检查靠它去重）
  for (const m of line.matchAll(ABS_RE)) {
    const text = trimTrailingPunct(m[0] ?? '');
    const start = m.index ?? 0;
    if (text.length < 4) continue;
    const end = start + text.length;
    const hit = matchProjectPath(text, opts.projects);
    push({ start, end, text, projectId: hit?.projectId ?? null, relPath: hit?.relPath ?? null });
  }

  if (opts.cwdProjectId !== null) {
    for (const m of line.matchAll(REL_RE)) {
      const raw = m[0] ?? '';
      const start = m.index ?? 0;
      // 紧邻 ':' 或分隔符 = URL/协议片段（http://、file:///）或更大路径的一部分，跳过
      const prev = start > 0 ? (line[start - 1] ?? '') : '';
      if (prev === ':' || prev === '/' || prev === '\\') continue;
      const text = trimTrailingPunct(raw);
      const last = text.split(/[\\/]/).pop() ?? '';
      if (!last.includes('.')) continue;
      const end = start + text.length;
      push({ start, end, text, projectId: opts.cwdProjectId, relPath: text.replace(/[\\/]+/g, '/') });
    }
  }

  return out;
}
