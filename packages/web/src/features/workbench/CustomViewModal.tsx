/**
 * 自定义「我的视图」编辑弹窗（FR-4.11 / KNOWN-GAPS #5）。
 * 字段＝FR-4.11 规定的七项：类型 / 语言 / 技术栈 / 集合 / 标签 / Git 状态 / 时间范围
 * （N 天没打开）。保存＝全量写 settings.custom_views_json（走 setSetting 乐观更新，
 * 服务端 zod 校验兜底）；不建新表——单用户小列表，与 recent_pins / ui_layout_json 同策略。
 * 语言/技术栈候选项来自当前项目聚合，允许自由输入（服务端等值/LIKE 匹配）。
 */
import { App, AutoComplete, Form, Input, InputNumber, Modal, Select } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { CollectionInfo, CustomView, ProjectSummary } from '@ttfolio/shared';
import { useSettings } from '@/app/settings';
import { ulidLike } from '@/lib/ulid';
import { typeLabel } from '@/components/DetailPanel';

const TYPE_OPTIONS = [
  'frontend',
  'backend',
  'fullstack',
  'split',
  'monolith',
  'microservice',
  'script',
  'assets',
  'unknown',
].map((t) => ({ value: t, label: typeLabel(t) }));

const GIT_OPTIONS = [
  { value: 'dirty', label: '有未提交改动' },
  { value: 'clean', label: '仓库干净' },
  { value: 'nogit', label: '非 Git 仓库' },
];

export function CustomViewModal({
  initial,
  onClose,
}: {
  /** null = 新建；编辑由父层用 key=视图 id 强制重挂载取快照 */
  initial: CustomView | null;
  onClose: () => void;
}): React.JSX.Element {
  const { settings, setSetting } = useSettings();
  const { message } = App.useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<string | undefined>(initial?.filters['type']);
  const [lang, setLang] = useState<string | undefined>(initial?.filters['lang']);
  const [stack, setStack] = useState<string | undefined>(initial?.filters['stack']);
  const [collection, setCollection] = useState<string | undefined>(initial?.filters['collection']);
  const [tag, setTag] = useState<string | undefined>(initial?.filters['tag']);
  const [git, setGit] = useState<string | undefined>(initial?.filters['git']);
  const [stale, setStale] = useState<number | undefined>(
    initial?.filters['stale'] !== undefined ? Number(initial.filters['stale']) : undefined,
  );

  const { data: projects } = useQuery({
    queryKey: ['projects', 'sidebar'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections'),
  });
  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: () =>
      api.get<Array<{ id: string; name: string; color: string | null; projectCount: number }>>('/api/tags'),
  });

  const langOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects ?? []) {
      if (p.primaryLanguage !== null && p.primaryLanguage !== '') set.add(p.primaryLanguage);
    }
    return [...set].sort().map((l) => ({ value: l }));
  }, [projects]);

  const stackOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects ?? []) {
      for (const t of p.techStack) set.add(t);
    }
    return [...set].sort().map((s) => ({ value: s }));
  }, [projects]);

  const save = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      void message.warning('请填写视图名称');
      return;
    }
    const filters: Record<string, string> = { status: 'active' };
    if (type !== undefined) filters['type'] = type;
    if (lang !== undefined && lang.trim() !== '') filters['lang'] = lang.trim();
    if (stack !== undefined && stack.trim() !== '') filters['stack'] = stack.trim();
    if (collection !== undefined) filters['collection'] = collection;
    if (tag !== undefined) filters['tag'] = tag;
    if (git !== undefined) filters['git'] = git;
    if (stale !== undefined && Number.isFinite(stale)) filters['stale'] = String(Math.round(stale));
    const view: CustomView = {
      id: initial?.id ?? ulidLike(),
      name: trimmed,
      filters,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    };
    const list = settings.customViews.filter((v) => v.id !== view.id);
    list.push(view);
    setSetting('customViews', list);
    void message.success(initial === null ? '视图已创建' : '视图已保存');
    onClose();
  };

  return (
    <Modal
      title={initial === null ? '新建视图' : `编辑视图：${initial.name}`}
      open
      onCancel={onClose}
      onOk={save}
      okText="保存视图"
      cancelText="取消"
      width={520}
      data-testid="customview-modal"
    >
      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="视图名称" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder="如：我负责的前端项目"
            data-testid="customview-name"
          />
        </Form.Item>
        <Form.Item label="类型">
          <Select options={TYPE_OPTIONS} value={type} onChange={setType} allowClear placeholder="不限" />
        </Form.Item>
        <Form.Item label="语言（主语言等值匹配）">
          <AutoComplete
            options={langOptions}
            value={lang}
            onChange={setLang}
            allowClear
            placeholder="如 ts；可从候选选择或自由输入"
          />
        </Form.Item>
        <Form.Item label="技术栈（子串匹配）">
          <AutoComplete
            options={stackOptions}
            value={stack}
            onChange={setStack}
            allowClear
            placeholder="如 React；可从候选选择或自由输入"
          />
        </Form.Item>
        <Form.Item label="集合">
          <Select
            options={(collections ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={collection}
            onChange={setCollection}
            allowClear
            placeholder="不限"
          />
        </Form.Item>
        <Form.Item label="标签">
          <Select
            options={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
            value={tag}
            onChange={setTag}
            allowClear
            placeholder="不限"
          />
        </Form.Item>
        <Form.Item label="Git 状态">
          <Select options={GIT_OPTIONS} value={git} onChange={setGit} allowClear placeholder="不限" />
        </Form.Item>
        <Form.Item label="时间范围（N 天没打开，含从未打开）">
          <InputNumber
            value={stale}
            onChange={(v) => setStale(v ?? undefined)}
            min={1}
            max={3650}
            style={{ width: '100%' }}
            placeholder="如 30"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
