/** 路径条（FR-1.5）：前进/后退/刷新 + Breadcrumb + 主题/密度/右栏开关。 */
import { Breadcrumb, Button, Dropdown, Space, Tooltip } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  SkinOutlined,
  ColumnWidthOutlined,
  BorderRightOutlined,
} from '@ant-design/icons';
import React from 'react';
import { navAvailability, useAppStore, type Tab, type TabLocation } from '@/app/store';
import { useSettings } from '@/app/settings';
import { useQueryClient } from '@tanstack/react-query';
import { SEMANTIC } from '@/theme/tokens';

export function PathBar(): React.JSX.Element {
  // 按字段订阅（体检 P2：全量订阅会被无关状态变化连带重渲染）
  const activeTabId = useAppStore((s) => s.activeTabId);
  const navigate = useAppStore((s) => s.navigate);
  const tabs = useAppStore((s) => s.tabs);
  const { settings, setSetting } = useSettings();
  const queryClient = useQueryClient();
  const tab = tabs.find((t) => t.id === activeTabId) ?? null;
  // 右栏详情依赖项目上下文：仅项目标签可切换（与 App 右栏折叠条件同口径）
  const canToggleDetail = tab !== null && tab.kind === 'project' && tab.projectId !== null;
  // 置灰而不是"按了没反应"：无历史可退时按钮必须是禁用态（原实现两个按钮永远可点但无效）
  const nav = navAvailability(tab);
  const [refreshing, setRefreshing] = React.useState(false);

  const crumbs = buildCrumbs(tab);

  // 前进/后退的"历史下拉"：让用户直接看到会退/进到哪里（用户反馈纯按钮"莫名其妙"）。
  // 选中即跳到该历史点（navigate 的 delta = 目标下标 - 当前下标）。
  const historyMenu = (dir: 'back' | 'forward') => {
    if (tab === null) return { items: [] };
    const hist = tab.history;
    const cur = tab.historyIndex;
    const idxs: number[] = [];
    if (dir === 'back') for (let i = cur; i >= 0 && i > cur - 15; i--) idxs.push(i);
    else for (let i = cur; i < hist.length && i < cur + 15; i++) idxs.push(i);
    return {
      items: idxs.flatMap((i) => {
        const loc = hist[i];
        if (loc === undefined) return [];
        const isCurrent = i === cur;
        return [
          {
            key: String(i),
            label: `${isCurrent ? '● 当前：' : ''}${locSummary(loc, tabs)}`,
            disabled: isCurrent,
          },
        ];
      }),
      onClick: (e: { key: string }) => {
        const target = Number(e.key);
        if (!Number.isNaN(target)) navigate(target - cur);
      },
    };
  };
  const neighborSummary = (dir: 'back' | 'forward'): string | null => {
    if (tab === null) return null;
    const idx = dir === 'back' ? tab.historyIndex - 1 : tab.historyIndex + 1;
    const loc = tab.history[idx];
    return loc === undefined ? null : locSummary(loc, tabs);
  };
  const backTarget = neighborSummary('back');
  const forwardTarget = neighborSummary('forward');

  const themeMenu = {
    items: [
      { key: 'light', label: '浅色（默认）' },
      { key: 'dark', label: '深色' },
      { key: 'oled', label: '电红色发光' },
      { key: 'cyberpunk', label: '赛博朋克' },
      { key: 'sketch', label: '极简手绘' },
      { key: 'system', label: '跟随系统' },
    ],
    selectable: true,
    selectedKeys: [settings.theme],
    onClick: (e: { key: string }) => setSetting('theme', e.key),
  };
  const densityMenu = {
    items: [
      { key: 'small', label: '紧凑' },
      { key: 'middle', label: '标准' },
      { key: 'large', label: '舒适' },
    ],
    selectable: true,
    selectedKeys: [settings.density],
    onClick: (e: { key: string }) => setSetting('density', e.key),
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 40,
        padding: '0 12px',
        borderBottom: `1px solid ${SEMANTIC.split}`,
      }}
    >
      <Space.Compact>
        <Dropdown menu={historyMenu('back')} trigger={['click']} placement="bottomLeft">
          <Tooltip title={backTarget !== null ? `后退到：${backTarget}` : '没有可后退的历史'}>
            <Button
              size="small"
              type="text"
              icon={<ArrowLeftOutlined />}
              disabled={!nav.back}
              onClick={() => navigate(-1)}
              data-testid="nav-back"
            />
          </Tooltip>
        </Dropdown>
        <Dropdown menu={historyMenu('forward')} trigger={['click']} placement="bottomLeft">
          <Tooltip title={forwardTarget !== null ? `前进到：${forwardTarget}` : '没有可前进的历史'}>
            <Button
              size="small"
              type="text"
              icon={<ArrowRightOutlined />}
              disabled={!nav.forward}
              onClick={() => navigate(1)}
              data-testid="nav-forward"
            />
          </Tooltip>
        </Dropdown>
        <Tooltip title="刷新视图（重新拉取全部数据；不影响未保存的编辑）">
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined spin={refreshing} />}
            data-testid="nav-refresh"
            onClick={() => {
              // 失效全部查询 = 重新拉取所有可见数据；编辑器由 EditorPane 自己做版本判断，
              // 未保存内容不会被覆盖（见 EditorPane 的"版本标识"守卫）。
              void queryClient.invalidateQueries();
              // 数据没变化时界面纹丝不动，用户感知就是"点了没用"——图标转一圈给明确反馈
              setRefreshing(true);
              window.setTimeout(() => setRefreshing(false), 600);
            }}
          />
        </Tooltip>
      </Space.Compact>
      <Breadcrumb items={crumbs} style={{ flex: 1 }} data-testid="pathbar-crumbs" />
      <Dropdown menu={themeMenu}>
        <Button size="small" type="text" icon={<SkinOutlined />} title="主题" />
      </Dropdown>
      <Dropdown menu={densityMenu}>
        <Button size="small" type="text" icon={<ColumnWidthOutlined />} />
      </Dropdown>
      {/* 体检用户反馈：非项目标签下右栏被强制折叠，点击/快捷键毫无视觉反馈像"坏了"——
          置灰并说明原因；右栏内容依赖项目上下文，仅在项目标签可用 */}
      <Tooltip title={canToggleDetail ? '右栏 (Ctrl+B)' : '右栏详情在打开项目后可用'}>
        <Button
          size="small"
          type="text"
          icon={<BorderRightOutlined />}
          disabled={!canToggleDetail}
          onClick={() => useAppStore.getState().setDetail(!useAppStore.getState().detailVisible)}
        />
      </Tooltip>
    </div>
  );
}

type Crumb = { title: React.ReactNode };

/** 可点击段的可视化包装（第 27 轮按用户反馈调整）：保持面包屑默认文字色与原布局，
 *  手型光标 + hover 浅背景块提示可点（不下划线、不变色；背景走 color-mix(currentColor)
 *  深浅主题自动适配——具体样式见 base.css 的 .tt-crumb-link）。
 *  第 26 轮教训：颜色/下划线等不能只写类规则（antd cssinjs 运行时注入会盖过），
 *  因此默认色用 color:inherit 显式声明，背景与圆角无覆盖冲突走类规则。 */
function crumbLink(text: string, onClick: () => void): Crumb {
  return {
    title: (
      <a className="tt-crumb-link" style={{ color: 'inherit', cursor: 'pointer' }} onClick={onClick}>
        {text}
      </a>
    ),
  };
}

/**
 * 面包屑（FR-1.5：域 / 项目 / 子路径，可逐级点击）。
 *
 * 关键修复（用户报障）：原实现只在 `tab.kind === 'file'` 时补文件名，但项目页打开的文件是挂在
 * **项目标签**上的（`kind === 'project'` + `targetPath`）→ 打开文件后面包屑永远只到「文件」，
 * 看不出当前在看哪个文件。现在凡是有 `targetPath` 就展示相对项目根的子路径，并按 `/` 逐级拆分。
 */
function buildCrumbs(tab: Tab | null): Crumb[] {
  if (tab === null || tab.kind === 'overview') {
    return [crumbLink('工作台', () => goHome())];
  }
  const crumbs: Crumb[] = [crumbLink('工作台', () => goHome())];
  if (tab.kind === 'project' && tab.projectId !== null) {
    const projectId = tab.projectId;
    crumbs.push(
      crumbLink(tab.title === '' ? '项目' : tab.title, () =>
        openAt({ kind: 'project', projectId, targetPath: null, subTab: 'overview' }),
      ),
    );
    // 子页签（文件/Git/架构图/文档）可点：跳回该子页签并清 targetPath（关闭右侧编辑器）。
    // 用户报障：打开文件后点「文件」没有反应、回不去文件列表页——原来这段是纯文本。
    if (tab.subTab !== null) {
      const subTab = tab.subTab;
      crumbs.push(
        crumbLink(subTabLabel(subTab), () =>
          openAt({ kind: 'project', projectId, targetPath: null, subTab }),
        ),
      );
    }
  } else {
    if (tab.title !== '') crumbs.push({ title: tab.title });
    if (tab.subTab !== null) crumbs.push({ title: subTabLabel(tab.subTab) });
  }
  // 子路径：把 targetPath 按 / \ 拆成多段，逐段显示（相对项目根，比只显示 basename 更可定位）。
  // 目录段（除最后一段外）可点：回文件列表并让树定位到该目录（FilesTab 消费 treeLocate）；
  // 最后一段是当前文件名——就是当前位置，保持纯文本。
  if (tab.targetPath !== null && tab.targetPath !== '' && tab.kind === 'project' && tab.projectId !== null) {
    const segs = tab.targetPath.split(/[\\/]/).filter((s) => s !== '' && s !== '.');
    const projectId = tab.projectId;
    segs.forEach((seg, i) => {
      if (i < segs.length - 1) {
        const dir = segs.slice(0, i + 1).join('/');
        crumbs.push(
          crumbLink(seg, () => {
            openAt({ kind: 'project', projectId, targetPath: null, subTab: tab.subTab });
            useAppStore.getState().setTreeLocate({ projectId, path: dir });
          }),
        );
      } else {
        crumbs.push({ title: seg });
      }
    });
  }
  return crumbs;
}

/** 面包屑"工作台"根：总览标签复用，不存在就新开（与顶栏「导入」按钮同一套语义）。 */
function goHome(): void {
  openAt({ kind: 'overview', projectId: null, targetPath: null, subTab: null });
}

/**
 * 把当前标签导航到某个位置。
 *
 * 用 `openTab` 而不是 `updateActiveLocation`：它带标签复用规则（项目标签的 tabKey 不含
 * targetPath，所以"项目 → 项目/某文件"仍是同一个标签，不会多开同名标签），并会压入历史栈。
 * `targetPath: null` 会被 `updateActiveLocation` 原样写入 →「回到项目根」同时关掉右侧编辑器。
 *
 * 标题按目标位置给：`openTab` 在复用既有标签时会把标题改成传入值，所以这里传当前标签的标题
 * **只在目标仍是同一个项目标签时**成立，否则会把「工作台」标签改叫项目名。
 */
function openAt(loc: Omit<TabLocation, 'scroll'>): void {
  const st = useAppStore.getState();
  const cur = st.tabs.find((t) => t.id === st.activeTabId);
  const title =
    loc.kind === 'overview'
      ? '工作台'
      : loc.kind === 'project' && cur !== undefined && cur.kind === 'project'
        ? cur.title
        : '';
  st.openTab({ ...loc, scroll: 0 }, title);
}

function subTabLabel(sub: string): string {
  switch (sub) {
    case 'overview':
      return '概览';
    case 'files':
      return '文件';
    case 'git':
      return 'Git';
    case 'archives':
      return '架构图';
    case 'docs':
      return '文档';
    case 'live':
      return '动态';
    default:
      return sub;
  }
}

/** 历史下拉里的一条位置摘要：让"后退/前进会去哪"一目了然。 */
function locSummary(loc: TabLocation, tabs: Tab[]): string {
  if (loc.kind === 'overview') {
    return loc.subTab === null || loc.subTab === '' ? '工作台总览' : `工作台 · ${loc.subTab}`;
  }
  if (loc.kind === 'settings') return '设置';
  if (loc.kind === 'trash') return '回收站';
  if (loc.kind === 'git' && loc.projectId !== null) {
    const name = tabs.find((t) => t.kind === 'project' && t.projectId === loc.projectId)?.title ?? '项目';
    return `${name} · ${loc.subTab === 'commit' ? `提交 ${loc.targetPath ?? ''}` : 'Git'}`;
  }
  if (loc.kind === 'project' && loc.projectId !== null) {
    const name = tabs.find((t) => t.kind === 'project' && t.projectId === loc.projectId)?.title ?? '项目';
    const seg = loc.targetPath !== null && loc.targetPath !== '' ? ` · ${loc.targetPath}` : '';
    return `${name} · ${subTabLabel(loc.subTab ?? 'files')}${seg}`;
  }
  return loc.targetPath ?? loc.kind;
}
