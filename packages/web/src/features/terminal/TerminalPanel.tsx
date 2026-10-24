/** 集成终端面板（FR-14.2 / T-104）：底部可开合、多标签、每标签独立 shell。
 *  伪终端跑在 Electron 主进程（node-pty），这里用 xterm.js 渲染并经 preload 桥收发；
 *  Web 模式无原生桥 → 如实提示「需桌面版」。会话语义：进程不跨重启存活，重启后为空。
 *  T-124：输出里的项目路径可点击直达文件页签（识别/配对纯函数见 terminalLinks.ts）；
 *  T-125：暴露最小注入 API（injectTerminalText）供 Git 断点场景预填命令，绝不代执行。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App as AntdApp, Button, Dropdown, Empty, Select, Space, Tooltip } from 'antd';
import { CloseOutlined, PlusOutlined, DownOutlined } from '@ant-design/icons';
import { Terminal } from '@xterm/xterm';
import type { IBufferLine, ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProjectDetail, ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';
import { extractPathsFromLine, type LinkProject } from './terminalLinks';

interface NativeTerminal {
  shells: () => Promise<{
    available: boolean;
    error: string | null;
    shells: Array<{ id: string; label: string }>;
    home: string;
    defaultShell: string;
  }>;
  create: (opts: {
    cwd: string;
    shell: string;
  }) => Promise<{ ok: boolean; id?: string; shell?: string; title?: string; error?: string }>;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (id: string) => void;
  onData: (cb: (id: string, data: string) => void) => () => void;
  onExit: (cb: (id: string, code: number) => void) => () => void;
}

function nativeTerm(): NativeTerminal | null {
  return (
    (window as unknown as { ttfolioNative?: { terminal?: NativeTerminal } }).ttfolioNative?.terminal ?? null
  );
}

interface TermTab {
  /** 本地标签 key（同一 shell 可开多个） */
  key: string;
  /** 主进程 pty id（创建成功后才有） */
  ptyId: string | null;
  shell: string;
  title: string;
  exited: number | null;
}

const MIN_H = 120;
const MAX_H = 640;

/** T-125：最小注入 API 的挂点（组件挂载时赋值、卸载时清空）。Web 模式恒 null，
 *  调用方据返回值如实降级。只写文本不带回车——预填后由用户检查并自己回车执行。 */
let terminalInjector: ((text: string) => void) | null = null;
export function injectTerminalText(text: string): boolean {
  if (terminalInjector === null) return false;
  terminalInjector(text);
  return true;
}

export function TerminalPanel(): React.JSX.Element {
  const setTerminalOpen = useAppStore((s) => s.setTerminalOpen);
  const { settings, setSetting } = useSettings();
  const { message } = AntdApp.useApp();
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const projectId = activeTab?.kind === 'project' ? activeTab.projectId : null;
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId ?? ''}`),
    enabled: projectId !== null,
  });
  // T-124：全部已登记项目（与侧栏共用缓存键）——绝对路径按 dirPath 前缀配对
  const { data: linkProjects } = useQuery({
    queryKey: ['projects', 'sidebar'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });

  const [meta, setMeta] = useState<Awaited<ReturnType<NativeTerminal['shells']>> | null>(null);
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [height, setHeight] = useState(() => {
    const h = settings.uiLayout.terminalHeight;
    return typeof h === 'number' && h >= MIN_H ? Math.min(MAX_H, h) : 280;
  });
  const termsRef = useRef(new Map<string, { term: Terminal; fit: FitAddon; host: HTMLDivElement }>());
  const keySeq = useRef(0);
  const tabsRef = useRef<TermTab[]>([]);

  const native = nativeTerm();
  const cwd = project?.dirPath ?? meta?.home ?? '';

  useEffect(() => {
    if (native === null) return;
    void native.shells().then(setMeta);
  }, [native]);

  // 主进程数据/退出事件 → 对应 xterm
  useEffect(() => {
    if (native === null) return undefined;
    const offData = native.onData((id, data) => {
      for (const tab of tabsRef.current) {
        if (tab.ptyId === id) {
          termsRef.current.get(tab.key)?.term.write(data);
          break;
        }
      }
    });
    const offExit = native.onExit((id, code) => {
      setTabs((prev) => prev.map((t) => (t.ptyId === id ? { ...t, exited: code } : t)));
    });
    return () => {
      offData();
      offExit();
    };
  }, [native]);

  // tabs 的最新值给事件回调用（避免每次变化重建订阅）
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const activeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  // T-124：识别上下文与点击动作走 ref——provider 在 TermHost 挂载时注册一次，
  // projects/cwd 变化不重建 xterm 实例，点击时读 ref 最新值
  const linkCtxRef = useRef<{ projects: LinkProject[]; cwdProjectId: string | null }>({
    projects: [],
    cwdProjectId: null,
  });
  useEffect(() => {
    linkCtxRef.current = {
      projects: (linkProjects ?? []).map((p) => ({ id: p.id, dirPath: p.dirPath })),
      cwdProjectId: projectId,
    };
  }, [linkProjects, projectId]);
  const actionsRef = useRef<{
    open: (pid: string, rel: string) => void;
    copy: (text: string) => void;
  }>({ open: () => {}, copy: () => {} });
  useEffect(() => {
    actionsRef.current = {
      open: (pid, rel) => {
        const p = (linkProjects ?? []).find((x) => x.id === pid);
        useAppStore.getState().openTab(
          {
            kind: 'project',
            projectId: pid,
            targetPath: rel === '' ? null : rel,
            subTab: 'files',
            scroll: 0,
          },
          p?.alias ?? p?.diskName ?? '项目',
        );
      },
      copy: (text) => {
        void navigator.clipboard.writeText(text);
        void message.info('路径不在已登记项目内，已复制路径');
      },
    };
  }, [linkProjects, message]);

  const createTab = useCallback(
    async (shell?: string) => {
      if (native === null || meta === null) return;
      if (cwd === '') return;
      const chosen = shell ?? settings.terminalShell ?? meta.defaultShell;
      const key = `t${++keySeq.current}`;
      const placeholder: TermTab = {
        key,
        ptyId: null,
        shell: chosen,
        title: meta.shells.find((s) => s.id === chosen)?.label ?? chosen,
        exited: null,
      };
      setTabs((prev) => [...prev, placeholder]);
      setActiveKey(key);
      const r = await native.create({ cwd, shell: chosen });
      if (r.ok !== true || r.id === undefined) {
        setTabs((prev) =>
          prev.map((t) =>
            t.key === key ? { ...t, exited: -1, title: `${placeholder.title}（启动失败）` } : t,
          ),
        );
        return;
      }
      setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ptyId: r.id ?? null } : t)));
    },
    [native, meta, cwd, settings.terminalShell],
  );

  // 首次打开且无标签：自动开一个（落在当前项目目录或主目录）
  useEffect(() => {
    if (meta === null || tabs.length > 0 || cwd === '') return;
    void createTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, cwd]);

  // T-125 注入 API：开面板 → 复用当前标签（无可用的就新建）→ 写入文本（不带 \r，
  // 绝不代执行——预填后由用户检查并自己回车）。cwd 用面板当前解析目录，调用点都在
  // 活动项目页签内，即仓库/项目根。Web 模式 injector 恒 null，调用方据返回值如实降级。
  useEffect(() => {
    if (native === null) return undefined;
    terminalInjector = (text: string) => {
      setTerminalOpen(true);
      const cur = tabsRef.current.find((t) => t.key === activeKeyRef.current);
      if (cur?.ptyId != null) {
        native.write(cur.ptyId, text);
        return;
      }
      void (async () => {
        await createTab();
        // pty id 异步回填：短轮询等一次（上限 1s，放弃后面板会显示启动失败态）
        for (let i = 0; i < 20; i++) {
          const t = tabsRef.current.find((x) => x.key === activeKeyRef.current);
          if (t?.ptyId != null) {
            native.write(t.ptyId, text);
            return;
          }
          await new Promise((r) => window.setTimeout(r, 50));
        }
      })();
    };
    return () => {
      terminalInjector = null;
    };
  }, [native, createTab, setTerminalOpen]);

  const closeTab = (key: string): void => {
    const tab = tabs.find((t) => t.key === key);
    if (tab?.ptyId != null && native !== null) native.kill(tab.ptyId);
    const inst = termsRef.current.get(key);
    if (inst !== undefined) {
      inst.term.dispose();
      inst.host.remove();
      termsRef.current.delete(key);
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.key !== key);
      if (activeKey === key) setActiveKey(next[next.length - 1]?.key ?? null);
      return next;
    });
  };

  const closeAll = (): void => {
    for (const t of tabs) closeTab(t.key);
    setTerminalOpen(false);
  };

  // 高度拖动：mousedown 记起点，move 改高度，up 落库（ui_layout_json，C-29）
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      const h = Math.max(MIN_H, Math.min(MAX_H, d.startH + (d.startY - e.clientY)));
      setHeight(h);
    };
    const onUp = (): void => {
      if (dragRef.current === null) return;
      dragRef.current = null;
      setSetting('uiLayout', { ...settings.uiLayout, terminalHeight: height });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [height, settings.uiLayout, setSetting]);

  if (native === null) {
    return (
      <div style={{ height: 160, borderTop: `1px solid ${SEMANTIC.split}`, padding: 12 }}>
        <Alert
          type="info"
          showIcon
          message="集成终端需要桌面版"
          description="浏览器（Web 模式）无法创建伪终端；请使用安装版。桌面版之外的「在此打开终端」仍可用（打开系统终端窗口）。"
        />
      </div>
    );
  }

  const noPty = meta !== null && meta.available !== true;

  return (
    <div
      style={{
        height,
        flexShrink: 0,
        borderTop: `1px solid ${SEMANTIC.split}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
      data-testid="terminal-panel"
    >
      {/* 拖动分隔条 */}
      <div
        onMouseDown={(e) => {
          dragRef.current = { startY: e.clientY, startH: height };
        }}
        style={{ height: 5, cursor: 'row-resize', background: 'transparent', flexShrink: 0 }}
        title="拖动调整终端高度"
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 8px',
          borderBottom: `1px solid ${SEMANTIC.split}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>终端</span>
        <div style={{ display: 'flex', gap: 4, flex: 1, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <span
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '1px 8px',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
                background: activeKey === t.key ? SEMANTIC.primaryBg : 'transparent',
                border: `1px solid ${activeKey === t.key ? SEMANTIC.primary : 'transparent'}`,
                whiteSpace: 'nowrap',
              }}
            >
              {t.title}
              {t.exited !== null && <span style={{ opacity: 0.5 }}>(已退出 {t.exited})</span>}
              <CloseOutlined
                style={{ fontSize: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.key);
                }}
              />
            </span>
          ))}
        </div>
        <Dropdown
          trigger={['click']}
          menu={{
            items: (meta?.shells ?? []).map((s) => ({ key: s.id, label: s.label })),
            onClick: ({ key }) => void createTab(key),
          }}
        >
          <Button size="small" icon={<PlusOutlined />} disabled={noPty}>
            新建 <DownOutlined style={{ fontSize: 9 }} />
          </Button>
        </Dropdown>
        <Tooltip title="关闭全部并收起面板（终端进程随窗口关闭结束）">
          <Button size="small" type="text" onClick={closeAll}>
            收起
          </Button>
        </Tooltip>
      </div>
      {noPty ? (
        <div style={{ padding: 12 }}>
          <Alert
            type="warning"
            showIcon
            message="node-pty 不可用"
            description={meta?.error ?? '原生模块未随包加载；请重装桌面版。'}
          />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {tabs.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`没有终端标签 · 起始目录：${cwd || '（未知）'}`}
              style={{ marginTop: 24 }}
            >
              <Space>
                <Button size="small" type="primary" onClick={() => void createTab()}>
                  新建终端
                </Button>
                <Select
                  size="small"
                  value={settings.terminalShell}
                  onChange={(v) => setSetting('terminalShell', v)}
                  options={(meta?.shells ?? []).map((s) => ({ value: s.id, label: s.label }))}
                  style={{ width: 180 }}
                />
              </Space>
            </Empty>
          )}
          {tabs.map((t) => (
            <TermHost
              key={t.key}
              tab={t}
              active={activeKey === t.key}
              cwd={cwd}
              onReady={(inst) => {
                termsRef.current.set(t.key, inst);
                registerPathLinks(inst.term, linkCtxRef, actionsRef);
              }}
              onInput={(data) => {
                if (t.ptyId != null && native !== null) native.write(t.ptyId, data);
              }}
              onResize={(cols, rows) => {
                if (t.ptyId != null && native !== null) native.resize(t.ptyId, cols, rows);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 逐 cell 扫描一行：文本 + 每个字符的 cell 列/宽映射。
 *  xterm 链接 range 用 cell 坐标（CJK 宽字符占 2 格、组合字符占 0 格），
 *  字符串下标不能直接当 x 用，必须经此映射换算。 */
function scanLineCells(line: IBufferLine): { text: string; colOf: number[]; widthOf: number[] } {
  let text = '';
  const colOf: number[] = [];
  const widthOf: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (cell === undefined) break;
    const w = cell.getWidth();
    if (w <= 0) continue; // 组合字符并入前格，无独立列
    const chars = cell.getChars();
    text += chars === '' ? ' ' : chars;
    const n = chars === '' ? 1 : chars.length;
    for (let k = 0; k < n; k++) {
      colOf.push(x);
      widthOf.push(w);
    }
  }
  return { text, colOf, widthOf };
}

/** T-124：把识别纯函数（terminalLinks.ts）接到 xterm link provider——
 *  每个 xterm 实例注册一次，项目/cwd 变化经 ref 取最新，不重建实例。 */
function registerPathLinks(
  term: Terminal,
  ctxRef: React.MutableRefObject<{ projects: LinkProject[]; cwdProjectId: string | null }>,
  actionsRef: React.MutableRefObject<{
    open: (pid: string, rel: string) => void;
    copy: (text: string) => void;
  }>,
): void {
  term.registerLinkProvider({
    provideLinks: (bufferLineNumber, callback) => {
      const line = term.buffer.active.getLine(bufferLineNumber);
      if (line === undefined) {
        callback(undefined);
        return;
      }
      const scan = scanLineCells(line);
      const links: ILink[] = [];
      for (const hit of extractPathsFromLine(scan.text, ctxRef.current)) {
        const lastIdx = hit.end - 1;
        const startCol = scan.colOf[hit.start] ?? hit.start;
        const lastCol = scan.colOf[lastIdx] ?? lastIdx;
        const lastW = scan.widthOf[lastIdx] ?? 1;
        links.push({
          range: {
            start: { x: startCol + 1, y: bufferLineNumber },
            end: { x: lastCol + lastW + 1, y: bufferLineNumber },
          },
          text: hit.text,
          activate: () => {
            if (hit.projectId !== null && hit.relPath !== null) {
              actionsRef.current.open(hit.projectId, hit.relPath);
            } else {
              actionsRef.current.copy(hit.text);
            }
          },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  });
}

/** 每个标签一个 xterm 实例（隐藏的标签用 display:none 保留缓冲与滚动位置）。 */
function TermHost({
  tab,
  active,
  cwd,
  onReady,
  onInput,
  onResize,
}: {
  tab: TermTab;
  active: boolean;
  cwd: string;
  onReady: (inst: { term: Terminal; fit: FitAddon; host: HTMLDivElement }) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const instRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);

  useEffect(() => {
    if (ref.current === null) return undefined;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      cursorBlink: true,
      scrollback: 2000,
      theme: { background: 'transparent' },
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    instRef.current = { term, fit };
    onReady({ term, fit, host: ref.current });
    try {
      fit.fit();
      onResize(term.cols, term.rows);
    } catch {
      /* 容器尚未布局 */
    }
    const inputSub = term.onData(onInput);
    // Ctrl+` 交还宿主（不吞掉），其余按键正常送进 pty
    term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.key === '`'));
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        onResize(term.cols, term.rows);
      } catch {
        /* 忽略 */
      }
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      inputSub.dispose();
      term.dispose();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换标签时重新 fit（隐藏期间尺寸为 0，激活后需要重算）
  useEffect(() => {
    if (!active) return;
    const inst = instRef.current;
    if (inst === null) return;
    const id = window.setTimeout(() => {
      try {
        inst.fit.fit();
        onResize(inst.term.cols, inst.term.rows);
        inst.term.focus();
      } catch {
        /* 忽略 */
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [active, onResize]);

  return (
    <div
      ref={ref}
      title={cwd}
      style={{
        position: 'absolute',
        inset: 0,
        padding: '4px 8px 6px',
        display: active ? 'block' : 'none',
      }}
      data-testid={`terminal-host-${tab.key}`}
    />
  );
}
