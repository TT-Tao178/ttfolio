/**
 * 集合编辑弹窗（评审二.6：PATCH /api/collections/:id 此前闲置——重命名与
 * 备注没有任何 UI）。名称必填，备注可选（空串存 null）。
 * 设置页集合卡与侧栏集合右键菜单共用。
 * create 模式（2026-11-03 用户需求）：collection=null + create 时为「新建集合」
 * （POST /api/collections），侧栏「集合」分组标题 + 号入口。
 * FR-15.1 父子集合：编辑模式可改父集合（候选排除自身与自身子树；深度 ≤3 由
 * 服务端强校验，此处仅做候选过滤与友好提示）。
 * FR-16.2 动态规则集合（T-133）：类型手动/规则切换 + 条件编辑器（≤5 条，
 * contains 不区分大小写；tag 按标签名包含）；规则集合成员查询时现算不落表。
 */
import { App as AntdApp, Button, Input, Modal, Segmented, Select } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { CollectionInfo, CollectionRuleCondition, CollectionRules } from '@ttfolio/shared';

export interface CollectionEditTarget {
  id: string;
  name: string;
  note: string | null;
  parentId?: string | null;
  kind?: 'manual' | 'rule';
  rules?: CollectionRules | null;
}

const RULE_FIELDS: Array<{ value: CollectionRuleCondition['field']; label: string }> = [
  { value: 'path', label: '路径包含' },
  { value: 'name', label: '名称包含' },
  { value: 'language', label: '主语言' },
  { value: 'stack', label: '技术栈' },
  { value: 'tag', label: '标签名' },
];

export function CollectionEditModal({
  collection,
  create = false,
  collections = [],
  onClose,
}: {
  collection: CollectionEditTarget | null;
  /** true = 新建集合（POST），此时忽略 collection */
  create?: boolean;
  /** 集合全表（FR-15.1 父集合候选；编辑时排除自身与自身子树） */
  collections?: CollectionInfo[];
  onClose: () => void;
}): React.JSX.Element | null {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [name, setName] = useState(collection?.name ?? '');
  const [note, setNote] = useState(collection?.note ?? '');
  const [parentId, setParentId] = useState<string | null>(collection?.parentId ?? null);
  const [kind, setKind] = useState<'manual' | 'rule'>(collection?.kind ?? 'manual');
  const [conditions, setConditions] = useState<CollectionRuleCondition[]>(
    collection?.rules?.conditions ?? [{ field: 'path', value: '' }],
  );
  // 每次打开都从目标集合同步（弹窗条件渲染 + 目标可变，不能只靠初始值）
  useEffect(() => {
    setName(collection?.name ?? '');
    setNote(collection?.note ?? '');
    setParentId(collection?.parentId ?? null);
    setKind(collection?.kind ?? 'manual');
    setConditions(collection?.rules?.conditions ?? [{ field: 'path', value: '' }]);
  }, [collection]);
  // 父候选：排除自身 + 自身子树 + 规则集合（防环 + FR-16.2 互斥；深度校验服务端兜底）
  const parentOptions = (() => {
    const selfId = create === true ? null : (collection?.id ?? null);
    const banned = new Set<string>();
    if (selfId !== null) {
      banned.add(selfId);
      let grew = true;
      while (grew) {
        grew = false;
        for (const c of collections) {
          if (c.parentId !== null && banned.has(c.parentId) && !banned.has(c.id)) {
            banned.add(c.id);
            grew = true;
          }
        }
      }
    }
    return collections
      .filter((c) => !banned.has(c.id) && c.kind !== 'rule')
      .map((c) => ({ value: c.id, label: c.name }));
  })();
  const save = useMutation({
    mutationFn: () => {
      const trimmedConditions = conditions
        .map((c) => ({ field: c.field, value: c.value.trim() }))
        .filter((c) => c.value !== '');
      const body = {
        name: name.trim(),
        note: note.trim() === '' ? null : note,
        parentId,
        kind,
        rules: kind === 'rule' ? { conditions: trimmedConditions } : null,
      };
      return create
        ? api.post('/api/collections', body)
        : api.patch(`/api/collections/${collection?.id}`, body);
    },
    onSuccess: () => {
      void message.success(create ? '已创建集合' : '已保存');
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      onClose();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });
  const hasValidConditions = kind === 'manual' || conditions.some((c) => c.value.trim() !== '');
  if (create === false && collection === null) return null;
  return (
    <Modal
      title={create ? '新建集合' : `编辑集合：${collection?.name ?? ''}`}
      open
      onCancel={onClose}
      onOk={() => save.mutate()}
      okText={create ? '创建' : '保存'}
      okButtonProps={{ loading: save.isPending, disabled: name.trim() === '' || !hasValidConditions }}
      cancelText="取消"
      width={480}
      data-testid={create ? 'collection-create-modal' : 'collection-edit-modal'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="集合名称" autoFocus />
        <Input.TextArea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可选，展示在设置页）"
        />
        <div>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>父集合（可选，最深 3 层）</div>
          <Select
            style={{ width: '100%' }}
            allowClear
            disabled={kind === 'rule'}
            placeholder={kind === 'rule' ? '规则集合不参与嵌套' : '顶层集合'}
            value={parentId ?? undefined}
            onChange={(v) => setParentId(typeof v === 'string' ? v : null)}
            options={parentOptions}
            optionFilterProp="label"
            showSearch
            data-testid="collection-parent-select"
          />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>
            集合类型（规则集合的成员按条件自动归集，不落成员表）
          </div>
          <Segmented
            value={kind}
            onChange={(v) => setKind(v as 'manual' | 'rule')}
            options={[
              { label: '手动', value: 'manual' },
              { label: '规则', value: 'rule' },
            ]}
            data-testid="collection-kind-seg"
          />
        </div>
        {kind === 'rule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.65 }}>
              命中条件（全部满足才算成员；包含匹配不区分大小写，≤5 条）
            </div>
            {conditions.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Select
                  size="small"
                  style={{ width: 110, flexShrink: 0 }}
                  value={c.field}
                  onChange={(v) => {
                    const next = [...conditions];
                    const cur = next[i];
                    if (cur !== undefined) next[i] = { ...cur, field: v };
                    setConditions(next);
                  }}
                  options={RULE_FIELDS}
                />
                <Input
                  size="small"
                  value={c.value}
                  onChange={(e) => {
                    const next = [...conditions];
                    const cur = next[i];
                    if (cur !== undefined) next[i] = { ...cur, value: e.target.value };
                    setConditions(next);
                  }}
                  placeholder={
                    c.field === 'tag' ? '标签名包含…' : c.field === 'language' ? '如 TypeScript' : '包含…'
                  }
                />
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  disabled={conditions.length <= 1}
                  onClick={() => setConditions((prev) => prev.filter((_, j) => j !== i))}
                />
              </div>
            ))}
            {conditions.length < 5 && (
              <Button
                size="small"
                type="dashed"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setConditions((prev) => [...prev, { field: 'path', value: '' }])}
              >
                加一条条件
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
