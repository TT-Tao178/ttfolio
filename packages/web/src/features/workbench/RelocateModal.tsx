/**
 * 重新定位弹窗（项目卡片菜单 / 项目详情页失效提示共用）。
 * 失效项目指向新目录：粘贴路径与系统目录对话框两种入口（与添加项目同模式，互为备份）。
 */
import { App, Button, Input, Modal, Space } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function RelocateModal({
  projectId,
  name,
  dirPath,
  open,
  onClose,
}: {
  projectId: string;
  name: string;
  dirPath: string;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [newPath, setNewPath] = useState('');
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (open) setNewPath('');
  }, [open]);
  const relocate = useMutation({
    mutationFn: () => api.post(`/api/projects/${projectId}/relocate`, { dirPath: newPath }),
    onSuccess: async () => {
      void message.success('已重新定位，正在重新分析');
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      onClose();
    },
    onError: (e) => void message.error(e instanceof Error ? e.message : '重新定位失败'),
  });
  const pick = async (): Promise<void> => {
    try {
      const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
      const first = r.paths[0];
      if (first !== undefined) setNewPath(first);
    } catch (e) {
      void message.error(e instanceof Error ? e.message : '选择目录失败');
    }
  };
  const submit = (): void => {
    if (newPath.trim() !== '') relocate.mutate();
  };
  return (
    <Modal title={`重新定位「${name}」`} open={open} onCancel={onClose} footer={null} width={560}>
      {/* 注意：data-testid 不要放在 <Modal> 上——它会落到零高度的 .ant-modal-root 包裹层，
          Playwright/测试的 visible 判定永远为 false；要放在内层可见元素上 */}
      <div data-testid="relocate-modal">
        <p style={{ opacity: 0.75 }}>
          原路径已失效：<span className="tt-mono">{dirPath}</span>
          <br />
          指向项目所在的新目录，原索引与分析数据将保留。
        </p>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onPressEnter={submit}
            placeholder="粘贴新目录的完整路径"
            data-testid="relocate-modal-input"
          />
          <Button icon={<FolderOpenOutlined />} onClick={() => void pick()} data-testid="relocate-modal-pick">
            选择目录…
          </Button>
          <Button
            type="primary"
            loading={relocate.isPending}
            disabled={newPath.trim() === ''}
            onClick={submit}
            data-testid="relocate-modal-ok"
          >
            定位
          </Button>
        </Space.Compact>
      </div>
    </Modal>
  );
}
