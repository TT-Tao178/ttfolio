/** 回归锚点：命令注册表纯函数（FR-13.6 / T-100）——模糊匹配、MRU 置顶、chord 解析与命中。 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_COMMANDS,
  chordMatches,
  effectiveChord,
  filterCommands,
  fuzzyScore,
  helpText,
  parseChord,
  pushMru,
  sortByMru,
  type CommandDef,
} from './registry';

describe('fuzzyScore（子序列模糊匹配）', () => {
  it('不匹配返回 -1；空查询 0', () => {
    expect(fuzzyScore('zzz', '打开设置')).toBe(-1);
    expect(fuzzyScore('', '打开设置')).toBe(0);
  });

  it('子序列命中；词首/连续命中得分更高', () => {
    expect(fuzzyScore('设置', '打开设置')).toBeGreaterThan(0);
    // 不做拼音转写：首字母缩写不算命中（如实行为，避免用户误期待）
    expect(fuzzyScore('dk', '打开设置')).toBe(-1);
    expect(fuzzyScore('os', 'open settings')).toBeGreaterThan(0);
    const wordStart = fuzzyScore('s', 'open settings');
    const mid = fuzzyScore('s', 'assets');
    expect(wordStart).toBeGreaterThan(mid);
    const consecutive = fuzzyScore('set', 'settings');
    const sparse = fuzzyScore('set', 's_e_t_x');
    expect(consecutive).toBeGreaterThan(sparse);
  });
});

describe('filterCommands（过滤 + 排序）', () => {
  const cmds: CommandDef[] = [
    { id: 'a', title: '打开设置', category: '视图', run: () => {} },
    { id: 'b', title: '打开回收站', category: '视图', run: () => {} },
    { id: 'c', title: '重新分析项目', category: '项目', run: () => {} },
  ];

  it('空查询原序返回；命中按分数排序', () => {
    expect(filterCommands(cmds, '').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    const hit = filterCommands(cmds, '设置');
    expect(hit.map((c) => c.id)).toEqual(['a']);
    expect(filterCommands(cmds, '打开').length).toBe(2);
  });
});

describe('MRU（最近使用置顶）', () => {
  const cmds: CommandDef[] = [
    { id: 'a', title: 'A', category: '视图', run: () => {} },
    { id: 'b', title: 'B', category: '视图', run: () => {} },
    { id: 'c', title: 'C', category: '视图', run: () => {} },
  ];

  it('push 去重前置并封顶', () => {
    expect(pushMru('b', ['a'])).toEqual(['b', 'a']);
    expect(pushMru('a', ['b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    const many = Array.from({ length: 12 }, (_, i) => `x${i}`);
    expect(pushMru('n', many)).toHaveLength(8);
  });

  it('sortByMru：MRU 内按其顺序在前，其余保持原序', () => {
    expect(sortByMru(cmds, ['c', 'a']).map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(sortByMru(cmds, []).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('chord 解析与命中（FR-11.4）', () => {
  it('解析修饰键与按键（字母小写、特殊键保留）', () => {
    expect(parseChord('Ctrl+Shift+P')).toEqual({ ctrl: true, shift: true, alt: false, key: 'p' });
    expect(parseChord('Ctrl+,')).toEqual({ ctrl: true, shift: false, alt: false, key: ',' });
    expect(parseChord('Alt+ArrowLeft')).toEqual({ ctrl: false, shift: false, alt: true, key: 'ArrowLeft' });
    expect(parseChord('Ctrl+Tab')).toEqual({ ctrl: true, shift: false, alt: false, key: 'Tab' });
    expect(parseChord('')).toBeNull();
  });

  it('chordMatches：Cmd 视同 Ctrl；shift 必须精确一致', () => {
    const chord = parseChord('Ctrl+Shift+P');
    if (chord === null) throw new Error('parse failed');
    const base = { key: 'P', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };
    expect(chordMatches(chord, base)).toBe(true);
    expect(chordMatches(chord, { ...base, metaKey: true, ctrlKey: false })).toBe(true);
    expect(chordMatches(chord, { ...base, shiftKey: false })).toBe(false);
  });

  it('effectiveChord：设置覆盖优先', () => {
    const cmd = BUILTIN_COMMANDS.find((c) => c.id === 'palette.commands');
    if (cmd === undefined) throw new Error('missing command');
    expect(effectiveChord(cmd, {})).toBe('Ctrl+Shift+P');
    expect(effectiveChord(cmd, { 'palette.commands': 'Ctrl+Alt+K' })).toBe('Ctrl+Alt+K');
  });

  it('helpText 由注册表生成且含改绑后的键；每个可改绑命令都有 id 与默认键', () => {
    const text = helpText({ 'palette.commands': 'Ctrl+Alt+K' });
    expect(text).toContain('Ctrl+Alt+K');
    expect(text).toContain('命令模式');
    const editable = BUILTIN_COMMANDS.filter((c) => c.keyEditable === true);
    expect(editable.length).toBeGreaterThanOrEqual(3);
    expect(editable.every((c) => typeof c.keys === 'string' && c.keys !== '')).toBe(true);
    // 至少覆盖 FR-11.4 点名的 保存/搜索/切页签
    const ids = new Set(editable.map((c) => c.id));
    expect(ids.has('editor.save')).toBe(true);
    expect(ids.has('palette.search')).toBe(true);
    expect(ids.has('tab.next')).toBe(true);
  });
});
