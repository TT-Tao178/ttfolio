/**
 * 集合编辑弹窗（评审二.6：PATCH /api/collections/:id 此前闲置——重命名与
 * 备注没有任何 UI）。名称必填，备注可选（空串存 null）。
 * 设置页集合卡与侧栏集合右键菜单共用。
 */
import { App as AntdApp, Input, Modal } from 'antd';
import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';

export interface CollectionEditTarget {
  id: string;
  name: string;
  note: string | null;
}

export function CollectionEditModal({
  collection,
  onClose,
}: {
  collection: CollectionEditTarget | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [name, setName] = useState(collection?.name ?? '');
  const [note, setNote] = useState(collection?.note ?? '');
  // 每次打开都从目标集合同步（弹窗条件渲染 + 目标可变，不能只靠初始值）
  useEffect(() => {
    setName(collection?.name ?? '');
    setNote(collection?.note ?? '');
  }, [collection]);
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/collections/${collection?.id}`, {
        name: name.trim(),
        note: note.trim() === '' ? null : note,
      }),
    onSuccess: () => {
      void message.success('已保存');
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      onClose();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });
  if (collection === null) return null;
  return (
    <Modal
      title={`编辑集合：${collection.name}`}
      open
      onCancel={onClose}
      onOk={() => save.mutate()}
      okText="保存"
      okButtonProps={{ loading: save.isPending, disabled: name.trim() === '' }}
      cancelText="取消"
      width={420}
      data-testid="collection-edit-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="集合名称" autoFocus />
        <Input.TextArea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可选，展示在设置页）"
        />
      </div>
    </Modal>
  );
}
