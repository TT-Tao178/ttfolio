/**
 * 标签会话 store 纯逻辑单测（第 33 轮）。
 * 覆盖历史 bug 回归锚点：标签爆炸（tabKey 不含 targetPath）、跨页签压栈
 * （sameLocation 完整位置比较）、脏标签关闭拦截、closedTabs 栈上限、
 * moveTab 固定区钳制、脏导航历史回落。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore, serializeSession, type TabLocation } from './store';

const loc = (over: Partial<TabLocation> = {}): TabLocation => ({
  kind: 'project',
  projectId: 'p1',
  targetPath: null,
  subTab: 'files',
  scroll: 0,
  ...over,
});

function reset(): void {
  useAppStore.setState({ tabs: [], activeTabId: null, closedTabs: [], dirty: new Map() });
}

beforeEach(reset);

describe('tabKey 标识规则', () => {
  it('项目标签不含 targetPath——打开文件后点卡片不开第二个标签（标签爆炸回归锚点）', () => {
    const s = useAppStore.getState();
    s.openTab(loc({ targetPath: null }), 'proj');
    s.openTab(loc({ targetPath: 'src/a.ts' }), 'proj');
    expect(useAppStore.getState().tabs).toHaveLength(1);
    // 且位置已同步到新文件
    expect(useAppStore.getState().tabs[0]?.targetPath).toBe('src/a.ts');
  });

  it('overview 按 subTab 区分——工作台总览与最近打开是不同标签', () => {
    const s = useAppStore.getState();
    s.openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台');
    s.openTab(
      { kind: 'overview', projectId: null, targetPath: null, subTab: 'view:recent', scroll: 0 },
      '最近打开',
    );
    expect(useAppStore.getState().tabs).toHaveLength(2);
  });

  it('file 类标签按 targetPath 区分——不同文件不同标签', () => {
    const s = useAppStore.getState();
    s.openTab({ kind: 'file', projectId: 'p1', targetPath: 'a.ts', subTab: null, scroll: 0 }, 'a');
    s.openTab({ kind: 'file', projectId: 'p1', targetPath: 'b.ts', subTab: null, scroll: 0 }, 'b');
    expect(useAppStore.getState().tabs).toHaveLength(2);
  });
});

describe('updateActiveLocation 历史栈', () => {
  it('项目内切页签压栈且可回放（跨页签不压栈回归锚点：文件→Git→后退回文件）', () => {
    const s = useAppStore.getState();
    s.openTab(loc({ targetPath: 'src/a.ts' }), 'proj');
    s.updateActiveLocation({ subTab: 'git' }, true);
    s.navigate(-1);
    const t = useAppStore.getState().tabs[0];
    expect(t?.subTab).toBe('files');
    s.navigate(1);
    expect(useAppStore.getState().tabs[0]?.subTab).toBe('git');
  });

  it('完整位置相同不重复压栈', () => {
    const s = useAppStore.getState();
    s.openTab(loc(), 'proj');
    s.updateActiveLocation({ scroll: 120 }, true);
    const t = useAppStore.getState().tabs[0];
    expect(t?.history).toHaveLength(1);
    expect(t?.scroll).toBe(120);
  });

  it('历史栈上限 100', () => {
    const s = useAppStore.getState();
    s.openTab(loc(), 'proj');
    for (let i = 0; i < 120; i++) {
      s.updateActiveLocation({ targetPath: `f${i}.ts` }, true);
    }
    expect(useAppStore.getState().tabs[0]?.history).toHaveLength(100);
  });
});

describe('closeTab 与 closedTabs 栈', () => {
  it('脏标签被拦截：返回 id、不关闭、不进栈', () => {
    const s = useAppStore.getState();
    s.openTab(loc({ targetPath: 'a.ts' }), 'a');
    const id = useAppStore.getState().tabs[0]?.id ?? '';
    s.markDirty('p1|a.ts');
    expect(s.closeTab(id)).toBe(id);
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useAppStore.getState().closedTabs).toHaveLength(0);
  });

  it('正常关闭进栈；上限 10', () => {
    const s = useAppStore.getState();
    for (let i = 0; i < 12; i++) {
      s.openTab(
        { kind: 'file', projectId: `p${i}`, targetPath: `f${i}.ts`, subTab: null, scroll: 0 },
        `t${i}`,
      );
    }
    for (let i = 0; i < 12; i++) {
      const t = useAppStore.getState().tabs[0];
      if (t === undefined) break;
      s.closeTab(t.id);
    }
    // 关掉最后一个后自动打开工作台总览（用户反馈：全关后不留空白）——
    // 栈里仍是 10 条（上限），当前唯一标签是总览
    expect(useAppStore.getState().tabs).toHaveLength(1);
    expect(useAppStore.getState().tabs[0]?.kind).toBe('overview');
    expect(useAppStore.getState().closedTabs).toHaveLength(10);
  });
});

describe('reopenLastClosed', () => {
  it('弹出最后关闭的并重开', () => {
    const s = useAppStore.getState();
    s.openTab({ kind: 'file', projectId: 'p1', targetPath: 'a.ts', subTab: null, scroll: 0 }, 'a');
    s.openTab({ kind: 'file', projectId: 'p1', targetPath: 'b.ts', subTab: null, scroll: 0 }, 'b');
    const b = useAppStore.getState().tabs[1];
    if (b === undefined) throw new Error('tab b missing');
    s.closeTab(b.id);
    s.reopenLastClosed();
    const tabs = useAppStore.getState().tabs;
    expect(tabs.some((t) => t.targetPath === 'b.ts')).toBe(true);
    expect(useAppStore.getState().closedTabs).toHaveLength(0);
  });

  it('栈空时 no-op', () => {
    const s = useAppStore.getState();
    s.reopenLastClosed();
    expect(useAppStore.getState().tabs).toHaveLength(0);
  });
});

describe('moveTab 固定区钳制', () => {
  function seed(): void {
    reset();
    const s = useAppStore.getState();
    s.openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, 'a');
    s.openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: 'x', scroll: 0 }, 'b');
    s.openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: 'y', scroll: 0 }, 'c');
    s.togglePin(useAppStore.getState().tabs[0]?.id ?? '');
  }

  it('非固定标签拖不进固定区（to=0 落到 pinCount 位置）', () => {
    seed();
    const s = useAppStore.getState();
    s.moveTab(2, 0); // c 想去最前
    const titles = useAppStore.getState().tabs.map((t) => t.title);
    expect(titles[0]).toBe('a'); // 固定的 a 仍在最前
    expect(titles).toEqual(['a', 'c', 'b']); // c 落到固定区之后的第一个位置
  });

  it('固定标签拖不出固定区', () => {
    seed();
    const s = useAppStore.getState();
    s.moveTab(0, 2); // 固定的 a 想去最后
    const titles = useAppStore.getState().tabs.map((t) => t.title);
    expect(titles[0]).toBe('a');
  });

  it('越界 no-op', () => {
    seed();
    const s = useAppStore.getState();
    const before = useAppStore.getState().tabs.map((t) => t.id);
    s.moveTab(0, 99);
    s.moveTab(-1, 1);
    expect(useAppStore.getState().tabs.map((t) => t.id)).toEqual(before);
  });
});

describe('parseNavHistory / serializeSession 往返', () => {
  it('脏 JSON 回落单点历史', () => {
    const s = useAppStore.getState();
    s.openTab(loc(), 'proj');
    useAppStore.setState({
      tabs: useAppStore.getState().tabs.map((t) => ({ ...t, history: [], historyIndex: -1 })),
    });
    // syncFromServer 走 parseNavHistory：navHistoryJson 脏数据 → 单点回落
    s.syncFromServer(
      [
        {
          id: 't1',
          kind: 'project',
          projectId: 'p1',
          targetPath: null,
          subTab: 'files',
          navHistoryJson: '{broken',
          navIndex: 0,
        },
      ],
      't1',
    );
    const t = useAppStore.getState().tabs[0];
    expect(t?.history).toHaveLength(1);
    expect(useAppStore.getState().activeTabId).toBe('t1');
  });

  it('serializeSession → syncFromServer 往返：历史与活动标签一致', () => {
    const s = useAppStore.getState();
    s.openTab(loc({ targetPath: 'a.ts' }), 'proj');
    s.updateActiveLocation({ subTab: 'git' }, true);
    const payload = serializeSession(useAppStore.getState().tabs, useAppStore.getState().activeTabId);
    reset();
    useAppStore.getState().syncFromServer(payload.tabs as never, payload.activeTabId);
    const t = useAppStore.getState().tabs[0];
    expect(t?.subTab).toBe('git');
    expect(t?.history).toHaveLength(2);
    expect(useAppStore.getState().activeTabId).toBe(payload.activeTabId);
  });

  it('syncFromServer：activeTabId 悬空时回落第一个标签（不出现空白内容区）', () => {
    const s = useAppStore.getState();
    s.syncFromServer(
      [{ id: 't1', kind: 'project', projectId: 'p1', targetPath: null, subTab: 'files' }],
      'missing-id',
    );
    expect(useAppStore.getState().activeTabId).toBe('t1');
  });

  it('serializeSession：历史超过 30 条截断时 index 同步平移（体检回归锚点）', () => {
    const s = useAppStore.getState();
    s.openTab(loc({ targetPath: 'a.ts' }), 'proj');
    // 连续导航造 40 条历史，当前位置在末尾（index=39）
    for (let i = 0; i < 39; i++) {
      s.updateActiveLocation({ targetPath: `f${i}.ts` }, true);
    }
    const before = useAppStore.getState().tabs[0];
    expect(before?.history.length).toBe(40);
    expect(before?.historyIndex).toBe(39);
    const payload = serializeSession(useAppStore.getState().tabs, useAppStore.getState().activeTabId);
    const nav = JSON.parse(String(payload.tabs[0]?.navHistoryJson ?? '{}')) as {
      history: unknown[];
      index: number;
    };
    // 截断保留尾部 30 条（原下标 10..39），index 平移 39-10=29
    expect(nav.history).toHaveLength(30);
    expect(nav.index).toBe(29);
    // 往返后当前位置仍指向同一 targetPath（平移前指向 f38.ts）
    reset();
    useAppStore.getState().syncFromServer(payload.tabs as never, payload.activeTabId);
    const t = useAppStore.getState().tabs[0];
    expect(t?.history[t?.historyIndex ?? 0]?.targetPath).toBe('f38.ts');
  });
});
